"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Archive,
  CalendarDays,
  Download,
  FileText,
  LoaderCircle,
  RefreshCw,
  Upload,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import TeachingMaterialPreview from "@/components/TeachingMaterialPreview";

const BUCKET = "teaching-private";
const CURRENT_PATH = "schedule/current-schedule.docx";
const ARCHIVE_FOLDER = "schedule/archive";
const SIGNED_URL_SECONDS = 3600;

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type ScheduleFile = {
  name: string;
  path: string;
  createdAt: string | null;
};

function formatDate(value: string | null) {
  if (!value) return "Date unavailable";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function makeArchivePath() {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

  return `${ARCHIVE_FOLDER}/${timestamp}-schedule.docx`;
}

export default function SchedulePage() {
  const supabase = useMemo(() => createClient(), []);

  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentExists, setCurrentExists] = useState(false);
  const [currentUpdatedAt, setCurrentUpdatedAt] = useState<string | null>(null);
  const [archives, setArchives] = useState<ScheduleFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<{
    url: string;
    fileName: string;
  } | null>(null);

  const loadSchedule = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      const user = session?.user;

      if (!user) {
        setIsAdmin(false);
        setCurrentExists(false);
        setCurrentUpdatedAt(null);
        setArchives([]);
        return;
      }

      const { data: adminRecord, error: adminError } = await supabase
        .from("teaching_admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (adminError) throw adminError;

      const admin = Boolean(adminRecord);
      setIsAdmin(admin);

      // Schedule documents are restricted to teaching administrators.
      if (!admin) {
        setCurrentExists(false);
        setCurrentUpdatedAt(null);
        setArchives([]);
        return;
      }

      const { data: currentFiles, error: currentError } = await supabase.storage
        .from(BUCKET)
        .list("schedule", {
          limit: 100,
        });

      if (currentError) throw currentError;

      const currentFile = (currentFiles ?? []).find(
        (file) => file.name === "current-schedule.docx",
      );

      setCurrentExists(Boolean(currentFile));
      setCurrentUpdatedAt(currentFile?.updated_at ?? null);

      if (currentFile) {
        const { data: signedData, error: signedError } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(CURRENT_PATH, SIGNED_URL_SECONDS);

        if (signedError) throw signedError;

        setPreview({
          url: signedData.signedUrl,
          fileName: "current-schedule.docx",
        });
      } else {
        setPreview(null);
      }

      const { data: archiveFiles, error: archiveError } = await supabase.storage
        .from(BUCKET)
        .list(ARCHIVE_FOLDER, {
          limit: 100,
          sortBy: { column: "name", order: "desc" },
        });

      if (archiveError) throw archiveError;

      setArchives(
        (archiveFiles ?? [])
          .filter(
            (file) =>
              file.name.toLowerCase().endsWith(".docx") &&
              file.name !== ".emptyFolderPlaceholder",
          )
          .map((file) => ({
            name: file.name,
            path: `${ARCHIVE_FOLDER}/${file.name}`,
            createdAt: file.created_at ?? null,
          })),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load schedules.",
      );
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void loadSchedule();
  }, [loadSchedule]);

  async function createPreviewUrl(path: string) {
    const { data, error: urlError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_SECONDS);

    if (urlError) throw urlError;
    if (!data?.signedUrl) throw new Error("Could not create a preview link.");

    return data.signedUrl;
  }

  async function openPreview(path: string, fileName: string) {
    setError("");

    try {
      const url = await createPreviewUrl(path);
      setPreview({ url, fileName });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to open this schedule.",
      );
    }
  }

  async function downloadSchedule(path: string, fileName: string) {
    setError("");

    try {
      const { data, error: downloadError } = await supabase.storage
        .from(BUCKET)
        .download(path);

      if (downloadError) throw downloadError;

      const objectUrl = URL.createObjectURL(data);
      const link = document.createElement("a");

      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to download this file.",
      );
    }
  }

  async function uploadSchedule() {
    if (!selectedFile) {
      setError("Please select a Word document first.");
      return;
    }

    if (!selectedFile.name.toLowerCase().endsWith(".docx")) {
      setError("Only .docx Word documents are supported.");
      return;
    }

    if (!isAdmin) {
      setError("Only authorized administrators can upload schedules.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    let archiveCreated = false;
    let archivePath = "";

    try {
      // Verify the current login and admin permission again before writing.
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) throw new Error("Please sign in again.");

      const { data: adminRecord, error: adminError } = await supabase
        .from("teaching_admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (adminError) throw adminError;
      if (!adminRecord) {
        setIsAdmin(false);
        throw new Error("Your account is not authorized to manage schedules.");
      }

      // If a current schedule exists, archive its contents first.
      if (currentExists) {
        const { data: oldFile, error: oldFileError } = await supabase.storage
          .from(BUCKET)
          .download(CURRENT_PATH);

        if (oldFileError) throw oldFileError;

        archivePath = makeArchivePath();

        const { error: archiveError } = await supabase.storage
          .from(BUCKET)
          .upload(archivePath, oldFile, {
            contentType: DOCX_MIME,
            upsert: false,
          });

        if (archiveError) {
          throw new Error(
            `The previous schedule could not be archived. The current schedule was not replaced. ${archiveError.message}`,
          );
        }

        archiveCreated = true;
      }

      // Publish the replacement only after archiving succeeds.
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(CURRENT_PATH, selectedFile, {
          contentType: DOCX_MIME,
          upsert: currentExists,
        });

      if (uploadError) {
        throw new Error(
          `The new schedule could not be published. ${
            archiveCreated
              ? "The previous schedule remains preserved in the archive. "
              : ""
          }${uploadError.message}`,
        );
      }

      // Refresh the list and automatically open the new document.
      setSelectedFile(null);

      const input = document.getElementById(
        "schedule-upload",
      ) as HTMLInputElement | null;

      if (input) input.value = "";

      await loadSchedule();

      const newUrl = await createPreviewUrl(CURRENT_PATH);

      setPreview({
        url: newUrl,
        fileName: "current-schedule.docx",
      });

      setNotice("Schedule uploaded successfully. Opening preview...");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Schedule upload failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="flex items-center gap-3 text-gray-600">
          <LoaderCircle className="animate-spin" size={22} />
          Checking schedule access...
        </div>
      </main>
    );
  }

  async function archiveCurrent() {
    if (!isAdmin || busy || !currentExists) return;

    if (
      !window.confirm(
        "Archive the current schedule? It will be moved to the archive and removed from Current Schedule.",
      )
    ) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    let archivePath = "";

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) throw new Error("Please sign in again.");

      const { data: adminRecord, error: adminError } = await supabase
        .from("teaching_admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (adminError) throw adminError;
      if (!adminRecord) throw new Error("Administrator access required.");

      const { data: oldFile, error: downloadError } = await supabase.storage
        .from(BUCKET)
        .download(CURRENT_PATH);

      if (downloadError) throw downloadError;

      archivePath = makeArchivePath();

      const { error: archiveError } = await supabase.storage
        .from(BUCKET)
        .upload(archivePath, oldFile, {
          contentType: DOCX_MIME,
          upsert: false,
        });

      if (archiveError) throw archiveError;

      // Remove the current file only after the archive upload succeeds.
      const { error: removeError } = await supabase.storage
        .from(BUCKET)
        .remove([CURRENT_PATH]);

      if (removeError) {
        throw new Error(
          `The archive was created, but the current file could not be removed. Archive: ${archivePath}. ${removeError.message}`,
        );
      }

      setPreview(null);
      setNotice("Current schedule archived successfully.");
      await loadSchedule();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to archive schedule.",
      );
      // Refresh in case the archive succeeded but a later step failed.
      await loadSchedule();
    } finally {
      setBusy(false);
    }
  }

  async function deleteCurrent() {
    if (!isAdmin || busy || !currentExists) return;

    if (
      !window.confirm(
        "Permanently delete the current schedule? This cannot be undone.",
      )
    ) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) throw new Error("Please sign in again.");

      const { data: adminRecord, error: adminError } = await supabase
        .from("teaching_admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (adminError) throw adminError;
      if (!adminRecord) throw new Error("Administrator access required.");

      const { error: removeError } = await supabase.storage
        .from(BUCKET)
        .remove([CURRENT_PATH]);

      if (removeError) throw removeError;

      setPreview(null);
      setNotice("Current schedule deleted.");
      await loadSchedule();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to delete schedule.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteArchivedSchedule(file: ScheduleFile) {
    if (!isAdmin || busy) return;

    if (
      !window.confirm(
        `Permanently delete archived schedule "${file.name}"? This cannot be undone.`,
      )
    ) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) throw new Error("Please sign in again.");

      const { data: adminRecord, error: adminError } = await supabase
        .from("teaching_admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (adminError) throw adminError;
      if (!adminRecord) throw new Error("Administrator access required.");

      const { error: removeError } = await supabase.storage
        .from(BUCKET)
        .remove([file.path]);

      if (removeError) throw removeError;

      if (preview?.fileName === file.name) {
        setPreview(null);
      }

      setNotice("Archived schedule deleted.");
      await loadSchedule();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to delete archive.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-900">
          ← Back to Home
        </Link>

        <header className="mb-8 mt-6">
          <p className="text-sm font-medium uppercase tracking-widest text-blue-700">
            Professional Practice
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Schedule
          </h1>
          <p className="mt-3 max-w-2xl text-gray-600">
            Secure access to the current schedule and previous versions.
          </p>
        </header>

        {error && (
          <div
            role="alert"
            className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
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

        {!isAdmin ? (
          <section className="rounded-2xl border bg-white p-8 shadow-sm">
            <h2 className="text-xl font-semibold">Access restricted</h2>
            <p className="mt-2 text-gray-600">
              Please sign in with an authorized account to view or download
              schedule documents.
            </p>
            <Link
              href="/auth/login"
              className="mt-5 inline-flex rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800"
            >
              Sign in
            </Link>
          </section>
        ) : (
          <>
            {preview && (
              <div className="mt-6">
                <TeachingMaterialPreview
                  url={preview.url}
                  fileName={preview.fileName}
                  inline
                  onClose={() => setPreview(null)}
                />
              </div>
            )}
            <section className="rounded-2xl border bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-blue-50 p-3 text-blue-700">
                    <CalendarDays size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold">Current Schedule</h2>
                    <p className="mt-1 text-sm text-gray-500">
                      Current official Word document
                    </p>
                    {currentUpdatedAt && (
                      <p className="mt-2 text-xs text-gray-500">
                        Last updated: {formatDate(currentUpdatedAt)}
                      </p>
                    )}
                  </div>
                </div>

                {currentExists && (
                  <span className="rounded-full bg-green-50 px-3 py-1 text-sm font-medium text-green-700">
                    Available
                  </span>
                )}
              </div>

              {currentExists ? (
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      void openPreview(CURRENT_PATH, "current-schedule.docx")
                    }
                    className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800"
                  >
                    Preview Schedule
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void downloadSchedule(
                        CURRENT_PATH,
                        "current-schedule.docx",
                      )
                    }
                    className="inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm hover:bg-gray-50"
                  >
                    <Download size={17} />
                    Download Word
                  </button>
                </div>
              ) : (
                <p className="mt-6 rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
                  No current schedule has been uploaded yet.
                </p>
              )}
              {currentExists && (
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void archiveCurrent()}
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-lg border border-amber-300 px-4 py-2.5 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                  >
                    <Archive size={17} />
                    {busy ? "Processing..." : "Archive Current"}
                  </button>

                  <button
                    type="button"
                    onClick={() => void deleteCurrent()}
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Delete Current
                  </button>
                </div>
              )}
              <div className="mt-7 border-t pt-6">
                <h3 className="font-semibold">Upload New Schedule</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Upload a .docx file. The current version will be archived
                  before it is replaced.
                </p>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <input
                    id="schedule-upload"
                    type="file"
                    accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={(event) =>
                      setSelectedFile(event.target.files?.[0] ?? null)
                    }
                    disabled={busy}
                    className="block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-gray-100 file:px-4 file:py-2.5 file:text-sm file:font-medium hover:file:bg-gray-200"
                  />

                  <button
                    type="button"
                    onClick={() => void uploadSchedule()}
                    disabled={busy || !selectedFile}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy ? (
                      <LoaderCircle className="animate-spin" size={17} />
                    ) : (
                      <Upload size={17} />
                    )}
                    {busy ? "Uploading..." : "Upload"}
                  </button>
                </div>

                {selectedFile && (
                  <p className="mt-2 text-sm text-gray-600">
                    Selected: {selectedFile.name}
                  </p>
                )}
              </div>
            </section>

            <section className="mt-8 rounded-2xl border bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-gray-100 p-3 text-gray-700">
                    <Archive size={23} />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold">Schedule Archive</h2>
                    <p className="mt-1 text-sm text-gray-500">
                      Previous schedule versions
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void loadSchedule()}
                  disabled={loading || busy}
                  className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  <RefreshCw size={15} />
                  Refresh
                </button>
              </div>

              {archives.length === 0 ? (
                <p className="mt-6 rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
                  No archived schedules yet. Previous versions will appear here
                  when a new schedule is uploaded.
                </p>
              ) : (
                <div className="mt-5 divide-y">
                  {archives.map((file) => (
                    <div
                      key={file.path}
                      className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <FileText
                          className="mt-1 shrink-0 text-gray-400"
                          size={20}
                        />
                        <div className="min-w-0">
                          <p className="break-all font-medium">{file.name}</p>
                          <p className="mt-1 text-xs text-gray-500">
                            Archived: {formatDate(file.createdAt)}
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void openPreview(file.path, file.name)}
                          className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void downloadSchedule(file.path, file.name)
                          }
                          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                        >
                          <Download size={15} />
                          Download
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteArchivedSchedule(file)}
                          disabled={busy}
                          className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        <p className="mt-8 text-center text-xs text-gray-400">
          Schedule documents are stored in private storage.
        </p>
      </div>
    </main>
  );
}
