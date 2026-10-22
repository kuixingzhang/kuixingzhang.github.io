"use client";

import SiteHeader from "@/components/SiteHeader";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  FileText,
  FileSpreadsheet,
  Presentation,
  Search,
  LockKeyhole,
  ArrowUpRight,
  FolderOpen,
  Upload,
  Trash2,
  Pencil,
  LogOut,
  LoaderCircle,
  ExternalLink,
  Download,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import TeachingMaterialPreview from "@/components/TeachingMaterialPreview";

const categories = [
  { id: "all", label: "All Materials", icon: BookOpen },
  { id: "presentation", label: "PowerPoint", icon: Presentation },
  { id: "pdf", label: "PDF Documents", icon: FileText },
  { id: "word", label: "Word Documents", icon: FileText },
  { id: "tables", label: "Tables & Worksheets", icon: FileSpreadsheet },
  { id: "reference", label: "Reference Materials", icon: FolderOpen },
];

const acceptedExtensions = ["ppt", "pptx", "pdf", "doc", "docx", "xls", "xlsx"];

type Material = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  file_name: string;
  file_path: string;
  bucket_id: "teaching-public" | "teaching-private";
  mime_type: string | null;
  file_size: number | null;
  is_public: boolean;
  created_at: string;
};

const emptyForm = {
  title: "",
  description: "",
  category: "presentation",
  isPublic: false,
};

function formatSize(bytes: number | null) {
  if (bytes == null) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileType(name: string) {
  return name.split(".").pop()?.toUpperCase() || "FILE";
}

function categoryLabel(id: string) {
  return categories.find((category) => category.id === id)?.label ?? id;
}

export default function TeachingPage() {
  const supabase = useMemo(() => createClient(), []);

  const [materials, setMaterials] = useState<Material[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [previewMaterial, setPreviewMaterial] = useState<{
    material: Material;
    url: string;
  } | null>(null);

  const [activeCategory, setActiveCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [editing, setEditing] = useState<Material | null>(null);
  const [editForm, setEditForm] = useState({
    title: "",
    description: "",
    category: "presentation",
    isPublic: false,
  });

  const loadMaterials = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      const user = session?.user ?? null;
      setUserId(user?.id ?? null);

      let admin = false;

      if (user) {
        const { data: adminRecord, error: adminError } = await supabase
          .from("teaching_admins")
          .select("user_id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (adminError) throw adminError;
        admin = Boolean(adminRecord);
      }

      setIsAdmin(admin);

      // Supabase RLS determines which records this visitor may see.
      const { data, error: materialsError } = await supabase
        .from("teaching_materials")
        .select("*")
        .order("created_at", { ascending: false });

      if (materialsError) throw materialsError;

      setMaterials((data ?? []) as Material[]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not load teaching materials.",
      );
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void loadMaterials();
  }, [loadMaterials]);

  const visibleMaterials = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return materials.filter((material) => {
      const matchesCategory =
        activeCategory === "all" || material.category === activeCategory;

      const matchesSearch =
        !query ||
        [
          material.title,
          material.description ?? "",
          material.file_name,
          material.category,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);

      return matchesCategory && matchesSearch;
    });
  }, [materials, activeCategory, searchQuery]);

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!isAdmin || !userId) {
      setError("Administrator access is required to upload files.");
      return;
    }

    if (!selectedFile) {
      setError("Please choose a file.");
      return;
    }

    const extension = selectedFile.name.split(".").pop()?.toLowerCase() ?? "";

    if (!acceptedExtensions.includes(extension)) {
      setError("Please upload a PPT, PPTX, PDF, DOC, DOCX, XLS, or XLSX file.");
      return;
    }

    if (selectedFile.size > 50 * 1024 * 1024) {
      setError("The maximum file size is 50 MB.");
      return;
    }

    const bucketId = form.isPublic ? "teaching-public" : "teaching-private";
    const safeName = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = `${userId}/${crypto.randomUUID()}-${safeName}`;

    setBusy(true);

    try {
      const { error: uploadError } = await supabase.storage
        .from(bucketId)
        .upload(filePath, selectedFile, {
          contentType: selectedFile.type || "application/octet-stream",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase
        .from("teaching_materials")
        .insert({
          title: form.title.trim(),
          description: form.description.trim() || null,
          category: form.category,
          file_name: selectedFile.name,
          file_path: filePath,
          bucket_id: bucketId,
          mime_type: selectedFile.type || null,
          file_size: selectedFile.size,
          is_public: form.isPublic,
          created_by: userId,
        });

      if (insertError) {
        // Avoid leaving an uploaded file behind if metadata insertion fails.
        await supabase.storage.from(bucketId).remove([filePath]);
        throw insertError;
      }

      setForm(emptyForm);
      setSelectedFile(null);
      setShowUpload(false);
      setNotice("Teaching material uploaded successfully.");
      await loadMaterials();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  function startEditing(material: Material) {
    setEditing(material);
    setEditForm({
      title: material.title,
      description: material.description ?? "",
      category: material.category,
      isPublic: material.is_public,
    });
    setError("");
    setNotice("");
  }

  async function handleUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!isAdmin || !editing) return;

    setBusy(true);

    try {
      const targetBucket = editForm.isPublic
        ? "teaching-public"
        : "teaching-private";

      let nextPath = editing.file_path;
      let nextBucket = editing.bucket_id;
      let movedFile = false;

      // Changing visibility requires moving the actual file between buckets.
      if (targetBucket !== editing.bucket_id) {
        const { data: blob, error: downloadError } = await supabase.storage
          .from(editing.bucket_id)
          .download(editing.file_path);

        if (downloadError) throw downloadError;

        const safeName = editing.file_name.replace(/[^a-zA-Z0-9._-]/g, "_");
        nextPath = `${userId}/${crypto.randomUUID()}-${safeName}`;

        const { error: uploadError } = await supabase.storage
          .from(targetBucket)
          .upload(nextPath, blob, {
            contentType: editing.mime_type || "application/octet-stream",
            upsert: false,
          });

        if (uploadError) throw uploadError;

        nextBucket = targetBucket;
        movedFile = true;
      }

      const { error: updateError } = await supabase
        .from("teaching_materials")
        .update({
          title: editForm.title.trim(),
          description: editForm.description.trim() || null,
          category: editForm.category,
          is_public: editForm.isPublic,
          bucket_id: nextBucket,
          file_path: nextPath,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editing.id);

      if (updateError) {
        if (movedFile) {
          await supabase.storage.from(nextBucket).remove([nextPath]);
        }
        throw updateError;
      }

      // Remove the old object only after the metadata update succeeds.
      if (movedFile) {
        const { error: removeError } = await supabase.storage
          .from(editing.bucket_id)
          .remove([editing.file_path]);

        if (removeError) {
          setNotice(
            "The material was updated, but the old file could not be removed. Please check Storage for an unused copy.",
          );
        }
      }

      setEditing(null);
      if (!notice) setNotice("Teaching material updated successfully.");
      await loadMaterials();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(material: Material) {
    if (!isAdmin) return;

    const confirmed = window.confirm(
      `Delete "${material.title}" and its uploaded file? This cannot be undone.`,
    );

    if (!confirmed) return;

    setError("");
    setNotice("");
    setBusy(true);

    try {
      const { error: rowError } = await supabase
        .from("teaching_materials")
        .delete()
        .eq("id", material.id);

      if (rowError) throw rowError;

      const { error: fileError } = await supabase.storage
        .from(material.bucket_id)
        .remove([material.file_path]);

      await loadMaterials();

      if (fileError) {
        setError(
          `The database record was deleted, but the file could not be removed from Storage: ${fileError.message}`,
        );
      } else {
        setNotice("Teaching material deleted.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function openMaterial(material: Material) {
    setError("");

    try {
      let url: string;

      if (material.bucket_id === "teaching-public") {
        const { data } = supabase.storage
          .from(material.bucket_id)
          .getPublicUrl(material.file_path);

        url = data.publicUrl;
      } else {
        const { data, error: signedUrlError } = await supabase.storage
          .from(material.bucket_id)
          .createSignedUrl(material.file_path, 300);

        if (signedUrlError) throw signedUrlError;

        url = data.signedUrl;
      }

      setPreviewMaterial({ material, url });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "You may not have permission to preview this file.",
      );
    }
  }

  async function downloadMaterial(material: Material) {
    setError("");

    try {
      const fileName = material.file_name;
      let url: string;

      if (material.bucket_id === "teaching-public") {
        const { data } = supabase.storage
          .from(material.bucket_id)
          .getPublicUrl(material.file_path, {
            download: fileName,
          });

        url = data.publicUrl;
      } else {
        const { data, error: signedUrlError } = await supabase.storage
          .from(material.bucket_id)
          .createSignedUrl(material.file_path, 300, {
            download: fileName,
          });

        if (signedUrlError) throw signedUrlError;

        url = data.signedUrl;
      }

      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "You may not have permission to download this file.",
      );
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = "/auth/login";
  }

  return (
    <main className="min-h-screen bg-white text-slate-800">
      <SiteHeader />
      <section className="border-b border-slate-200 bg-slate-50/70">
        <div className="site-container py-14 md:py-16">
          <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-[#315b85]">
            Dr. Zhang Pathology / Teaching
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-[#1b2e50] md:text-5xl">
            Teaching Library
          </h1>
        </div>
      </section>

      <section className="site-container py-12 md:py-14">
        <div className="mb-8">
          <h2 className="text-2xl font-semibold tracking-tight text-[#1b2e50]">
            Browse Resources
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Search by title, topic, file type, or category.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
          </div>
        )}
        {notice && (
          <div
            role="status"
            className="mb-5 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800"
          >
            {notice}
          </div>
        )}

        <div className="mb-8 flex flex-col gap-3 sm:flex-row">
          <label className="relative block flex-1">
            <span className="sr-only">Search teaching materials</span>
            <Search
              size={19}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search teaching materials..."
              className="w-full rounded-lg border border-slate-300 bg-white py-3 pl-11 pr-4 text-sm outline-none focus:border-[#315b85] focus:ring-2 focus:ring-blue-100"
            />
          </label>

          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setShowUpload((value) => !value);
                setError("");
                setNotice("");
              }}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1b2e50] px-5 py-3 text-sm font-semibold text-white hover:bg-[#29456f]"
            >
              <Upload size={16} />
              {showUpload ? "Cancel Upload" : "Upload Material"}
            </button>
          )}
        </div>

        {isAdmin && showUpload && (
          <form
            onSubmit={handleUpload}
            className="mb-10 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-5"
          >
            <h3 className="text-lg font-semibold text-[#1b2e50]">
              Upload a teaching material
            </h3>

            <label className="block text-sm font-medium">
              Title *
              <input
                required
                maxLength={200}
                value={form.title}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal"
              />
            </label>

            <label className="block text-sm font-medium">
              Description
              <textarea
                rows={3}
                maxLength={2000}
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Category
                <select
                  value={form.category}
                  onChange={(event) =>
                    setForm({ ...form, category: event.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal"
                >
                  {categories
                    .filter((category) => category.id !== "all")
                    .map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.label}
                      </option>
                    ))}
                </select>
              </label>

              <label className="block text-sm font-medium">
                File *
                <input
                  required
                  type="file"
                  accept=".ppt,.pptx,.pdf,.doc,.docx,.xls,.xlsx"
                  onChange={(event) =>
                    setSelectedFile(event.target.files?.[0] ?? null)
                  }
                  className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2 text-sm font-normal"
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  PPT, PPTX, PDF, DOC, DOCX, XLS, XLSX · Maximum 50 MB
                </span>
              </label>
            </div>

            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={form.isPublic}
                onChange={(event) =>
                  setForm({ ...form, isPublic: event.target.checked })
                }
                className="h-4 w-4"
              />
              Publish publicly (unchecked means private; default is private)
            </label>

            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-[#1b2e50] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy && <LoaderCircle size={16} className="animate-spin" />}
              Upload File
            </button>
          </form>
        )}

        <div className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {categories.map((category) => {
            const Icon = category.icon;
            const isActive = activeCategory === category.id;

            return (
              <button
                key={category.id}
                type="button"
                onClick={() => setActiveCategory(category.id)}
                aria-pressed={isActive}
                className={`rounded-xl border p-4 text-left transition ${
                  isActive
                    ? "border-[#315b85] bg-blue-50/70"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <Icon
                  size={22}
                  strokeWidth={1.7}
                  className={isActive ? "text-[#315b85]" : "text-slate-500"}
                />
                <h3 className="mt-4 text-sm font-semibold text-slate-900">
                  {category.label}
                </h3>
              </button>
            );
          })}
        </div>

        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[#1b2e50]">
            {activeCategory === "all"
              ? "Teaching Materials"
              : categoryLabel(activeCategory)}
          </h2>
          <span className="text-xs text-slate-500">
            {visibleMaterials.length}{" "}
            {visibleMaterials.length === 1 ? "item" : "items"}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-3 rounded-xl border border-slate-200 py-12 text-sm text-slate-500">
            <LoaderCircle size={20} className="animate-spin" />
            Loading teaching materials...
          </div>
        ) : visibleMaterials.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {visibleMaterials.map((material) => {
              const extension = fileType(material.file_name);
              const Icon =
                extension === "PDF"
                  ? FileText
                  : ["XLS", "XLSX"].includes(extension)
                    ? FileSpreadsheet
                    : Presentation;

              return (
                <article
                  key={material.id}
                  className="rounded-xl border border-slate-200 p-5 transition hover:border-slate-300"
                >
                  <div className="flex items-start gap-4">
                    <div className="rounded-lg bg-slate-100 p-3 text-[#315b85]">
                      <Icon size={23} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-semibold text-[#315b85]">
                        <button
                          type="button"
                          onClick={() => void openMaterial(material)}
                          className="text-left hover:underline"
                        >
                          {material.title}
                        </button>
                      </h3>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                        {material.description || "No description provided."}
                      </p>
                      <p className="mt-3 text-xs text-slate-500">
                        {extension} · {categoryLabel(material.category)} ·{" "}
                        {formatSize(material.file_size)}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                        {material.is_public ? (
                          <span className="rounded-full bg-green-50 px-2.5 py-1 text-green-800">
                            Public
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
                            <LockKeyhole size={12} /> Private
                          </span>
                        )}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => void downloadMaterial(material)}
                          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700 hover:underline"
                        >
                          <Download size={14} /> Download
                        </button>

                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              onClick={() => startEditing(material)}
                              className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700 hover:underline"
                            >
                              <Pencil size={14} /> Edit
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleDelete(material)}
                              className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-700 hover:underline disabled:opacity-50"
                            >
                              <Trash2 size={14} /> Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200">
              <FolderOpen size={23} strokeWidth={1.6} />
            </div>
            <h3 className="mt-5 text-base font-semibold text-[#1b2e50]">
              {searchQuery.trim()
                ? "No matching materials"
                : "Teaching materials coming soon"}
            </h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
              {searchQuery.trim()
                ? "Try another search term or choose a different category."
                : "New presentations, PDF handouts, and practical worksheets will appear here as they are published."}
            </p>
            {searchQuery.trim() && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setActiveCategory("all");
                }}
                className="mt-5 text-sm font-semibold text-[#315b85] hover:underline"
              >
                Clear search
              </button>
            )}
          </div>
        )}

        {editing && isAdmin && (
          <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/40 p-4">
            <form
              onSubmit={handleUpdate}
              className="my-8 w-full max-w-xl space-y-4 rounded-xl bg-white p-6 shadow-xl"
            >
              <h2 className="text-xl font-semibold text-[#1b2e50]">
                Edit teaching material
              </h2>
              <p className="break-all text-xs text-slate-500">
                {editing.file_name}
              </p>

              <label className="block text-sm font-medium">
                Title *
                <input
                  required
                  maxLength={200}
                  value={editForm.title}
                  onChange={(event) =>
                    setEditForm({ ...editForm, title: event.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal"
                />
              </label>

              <label className="block text-sm font-medium">
                Description
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={editForm.description}
                  onChange={(event) =>
                    setEditForm({
                      ...editForm,
                      description: event.target.value,
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal"
                />
              </label>

              <label className="block text-sm font-medium">
                Category
                <select
                  value={editForm.category}
                  onChange={(event) =>
                    setEditForm({ ...editForm, category: event.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal"
                >
                  {categories
                    .filter((category) => category.id !== "all")
                    .map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.label}
                      </option>
                    ))}
                </select>
              </label>

              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={editForm.isPublic}
                  onChange={(event) =>
                    setEditForm({ ...editForm, isPublic: event.target.checked })
                  }
                  className="h-4 w-4"
                />
                Publicly accessible
              </label>

              <p className="text-xs leading-5 text-slate-500">
                Changing visibility moves the file between the public and
                private storage buckets.
              </p>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  disabled={busy}
                  className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#1b2e50] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy && <LoaderCircle size={16} className="animate-spin" />}
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        )}

        {!userId && (
          <div className="mt-10 flex flex-col gap-4 rounded-xl border border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <LockKeyhole
                size={20}
                className="mt-0.5 shrink-0 text-slate-500"
              />
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Private teaching materials
                </h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Sign in with an authorized account to access private
                  resources.
                </p>
              </div>
            </div>
            <Link
              href="/auth/login"
              className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-[#315b85] hover:underline"
            >
              Sign in <ArrowUpRight size={16} />
            </Link>
          </div>
        )}
      </section>

      <footer className="border-t border-slate-200">
        <div className="site-container flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs leading-5 text-slate-500">
            <p>© 2026 Kuixing Zhang, MD, PhD.</p>
            <p>Dr. Zhang Pathology · Diagnostic Excellence</p>
          </div>
          <Link
            href="/"
            className="text-sm font-medium text-slate-600 hover:text-slate-950"
          >
            Back to Home
          </Link>
        </div>
      </footer>
      {previewMaterial && (
        <TeachingMaterialPreview
          url={previewMaterial.url}
          fileName={previewMaterial.material.file_name}
          onClose={() => setPreviewMaterial(null)}
        />
      )}
    </main>
  );
}
