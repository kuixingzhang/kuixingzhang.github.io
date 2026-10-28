"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Archive,
  CalendarDays,
  Download,
  FileText,
  FileSpreadsheet,
  LoaderCircle,
  RefreshCw,
  Upload,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import TeachingMaterialPreview from "@/components/TeachingMaterialPreview";

const BUCKET = "teaching-private";
const ARCHIVE_FOLDER = "schedule/archive";
const SCHEDULE_FOLDER = "schedule";
const SIGNED_URL_SECONDS = 3600;

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PDF_MIME = "application/pdf";

type ScheduleExtension = "docx" | "xlsx" | "pdf";

type ScheduleFile = {
  name: string;
  path: string;
  createdAt: string | null;
};

type CurrentSchedule = {
  name: string;
  path: string;
  updatedAt: string | null;
  extension: ScheduleExtension;
};

function getScheduleExtension(fileName: string): ScheduleExtension | null {
  const name = fileName.toLowerCase();

  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".xlsx")) return "xlsx";
  if (name.endsWith(".pdf")) return "pdf";

  return null;
}

function getScheduleMime(extension: ScheduleExtension) {
  if (extension === "xlsx") return XLSX_MIME;
  if (extension === "pdf") return PDF_MIME;
  return DOCX_MIME;
}

function getCurrentPath(extension: ScheduleExtension) {
  return `${SCHEDULE_FOLDER}/current-schedule.${extension}`;
}

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

function makeArchivePath(extension: ScheduleExtension) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

  return `${ARCHIVE_FOLDER}/${timestamp}-schedule.${extension}`;
}

function isScheduleFileName(fileName: string) {
  return getScheduleExtension(fileName) !== null;
}

export default function SchedulePage() {
  const supabase = useMemo(() => createClient(), []);

  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentSchedule, setCurrentSchedule] =
    useState<CurrentSchedule | null>(null);
  const [archives, setArchives] = useState<ScheduleFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [currentConflict, setCurrentConflict] = useState(false);
  const [preview, setPreview] = useState<{
    url: string;
    fileName: string;
  } | null>(null);

  const currentExists = currentSchedule !== null;

  const loadSchedule = useCallback(async () => {
    setLoading(true);
    setError("");
    setCurrentConflict(false);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      const user = session?.user;

      if (!user) {
        setIsAdmin(false);
        setCurrentSchedule(null);
        setArchives([]);
        setPreview(null);
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
        setCurrentSchedule(null);
        setArchives([]);
        setPreview(null);
        return;
      }

      const { data: currentFiles, error: currentError } = await supabase.storage
        .from(BUCKET)
        .list(SCHEDULE_FOLDER, {
          limit: 100,
        });

      if (currentError) throw currentError;

      const currentCandidates = (currentFiles ?? []).filter(
        (file) =>
          isScheduleFileName(file.name) &&
          file.name.startsWith("current-schedule."),
      );

      // Do not silently choose one if both formats exist in the current folder.
      if (currentCandidates.length > 1) {
        setCurrentSchedule(null);
        setPreview(null);
        setCurrentConflict(true);
        setError(
          "Both current-schedule.docx and current-schedule.xlsx exist. Please resolve the duplicate current files in Supabase Storage before uploading or managing schedules.",
        );
      } else if (currentCandidates.length === 1) {
        const file = currentCandidates[0];
        const extension = getScheduleExtension(file.name);

        if (!extension) {
          setCurrentSchedule(null);
          setPreview(null);
        } else {
          const path = `${SCHEDULE_FOLDER}/${file.name}`;
          const current: CurrentSchedule = {
            name: file.name,
            path,
            updatedAt: file.updated_at ?? null,
            extension,
          };

          setCurrentSchedule(current);

          const { data: signedData, error: signedError } =
            await supabase.storage
              .from(BUCKET)
              .createSignedUrl(path, SIGNED_URL_SECONDS);

          if (signedError) throw signedError;

          setPreview({
            url: signedData.signedUrl,
            fileName: file.name,
          });
        }
      } else {
        setCurrentSchedule(null);
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
              isScheduleFileName(file.name) &&
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

  async function verifyAdminAccess() {
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
  }

  async function uploadSchedule() {
    if (!selectedFile) {
      setError("Please select a Word document, Excel workbook, or PDF first.");
      return;
    }

    const newExtension = getScheduleExtension(selectedFile.name);

    if (!newExtension) {
      setError(
        "Only .docx Word documents, .xlsx Excel workbooks, and .pdf files are supported.",
      );
      return;
    }

    if (!isAdmin) {
      setError("Only authorized administrators can upload schedules.");
      return;
    }

    if (currentConflict) {
      setError(
        "Resolve the duplicate current schedule files in Supabase Storage before uploading a replacement.",
      );
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    let archivePath: string | null = null;
    let newPath: string | null = null;
    let newFileUploaded = false;

    try {
      await verifyAdminAccess();

      const oldCurrent = currentSchedule;

      // Preserve the current file before replacing or removing it.
      if (oldCurrent) {
        const { data: oldFile, error: oldFileError } = await supabase.storage
          .from(BUCKET)
          .download(oldCurrent.path);

        if (oldFileError) throw oldFileError;

        archivePath = makeArchivePath(oldCurrent.extension);

        const { error: archiveError } = await supabase.storage
          .from(BUCKET)
          .upload(archivePath, oldFile, {
            contentType: getScheduleMime(oldCurrent.extension),
            upsert: false,
          });

        if (archiveError) {
          archivePath = null;
          throw new Error(
            `The previous schedule could not be archived. The current schedule was not replaced. ${archiveError.message}`,
          );
        }
      }

      newPath = getCurrentPath(newExtension);

      // When switching formats, upload to the new path first. Keep the old
      // current file until the new upload succeeds.
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(newPath, selectedFile, {
          contentType: getScheduleMime(newExtension),
          upsert: oldCurrent?.path === newPath,
        });

      if (uploadError) {
        throw new Error(
          `The new schedule could not be published. ${
            archivePath
              ? "The previous schedule remains preserved in the archive. "
              : ""
          }${uploadError.message}`,
        );
      }

      newFileUploaded = true;

      // If switching extensions, remove the previous current file only after
      // the new file has been uploaded successfully. If removal fails, remove
      // the new file to avoid leaving two current schedules.
      if (oldCurrent && oldCurrent.path !== newPath) {
        const { error: removeOldError } = await supabase.storage
          .from(BUCKET)
          .remove([oldCurrent.path]);

        if (removeOldError) {
          const { error: rollbackError } = await supabase.storage
            .from(BUCKET)
            .remove([newPath]);

          newFileUploaded = false;

          throw new Error(
            `The new schedule was uploaded, but the previous current file could not be removed. ${
              rollbackError
                ? `Automatic cleanup of the new file also failed: ${rollbackError.message}. `
                : "The new file was removed to avoid having two current schedules. "
            }${removeOldError.message}`,
          );
        }
      }

      setSelectedFile(null);
      const input = document.getElementById(
        "schedule-upload",
      ) as HTMLInputElement | null;
      if (input) input.value = "";

      setNotice("Schedule uploaded successfully.");
      await loadSchedule();

      // Recreate a fresh signed URL and open the new current schedule.
      const refreshedPath = getCurrentPath(newExtension);
      const newUrl = await createPreviewUrl(refreshedPath);
      setPreview({
        url: newUrl,
        fileName: `current-schedule.${newExtension}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Schedule upload failed.");

      // If an upload was completed but a later step failed, do not delete the
      // new file automatically here: the error message and archive preserve
      // the information needed for safe recovery.
      void newFileUploaded;
      await loadSchedule();
    } finally {
      setBusy(false);
    }
  }

  async function archiveCurrent() {
    if (!isAdmin || busy || !currentSchedule || currentConflict) return;

    if (
      !window.confirm(
        "Archive the current schedule? It will be removed from Current Schedule after the archive succeeds.",
      )
    ) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      await verifyAdminAccess();

      const current = currentSchedule;

      const { data: oldFile, error: downloadError } = await supabase.storage
        .from(BUCKET)
        .download(current.path);

      if (downloadError) throw downloadError;

      const archivePath = makeArchivePath(current.extension);

      const { error: archiveError } = await supabase.storage
        .from(BUCKET)
        .upload(archivePath, oldFile, {
          contentType: getScheduleMime(current.extension),
          upsert: false,
        });

      if (archiveError) throw archiveError;

      const { error: removeError } = await supabase.storage
        .from(BUCKET)
        .remove([current.path]);

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
      await loadSchedule();
    } finally {
      setBusy(false);
    }
  }

  async function deleteCurrent() {
    if (!isAdmin || busy || !currentSchedule || currentConflict) return;

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
      await verifyAdminAccess();

      const { error: removeError } = await supabase.storage
        .from(BUCKET)
        .remove([currentSchedule.path]);

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
      await verifyAdminAccess();

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
                      Current official Word document, Excel workbook, or PDF
                    </p>
                    {currentSchedule?.updatedAt && (
                      <p className="mt-2 text-xs text-gray-500">
                        Last updated: {formatDate(currentSchedule.updatedAt)}
                      </p>
                    )}
                    {currentSchedule && (
                      <p className="mt-2 break-all text-xs text-gray-500">
                        File: {currentSchedule.name}
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

              {currentConflict ? (
                <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  Two current schedule files were found. Please resolve this in
                  Supabase Storage before previewing, replacing, archiving, or
                  deleting the current schedule.
                </p>
              ) : currentSchedule ? (
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      void openPreview(
                        currentSchedule.path,
                        currentSchedule.name,
                      )
                    }
                    className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800"
                  >
                    Preview Schedule
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void downloadSchedule(
                        currentSchedule.path,
                        currentSchedule.name,
                      )
                    }
                    className="inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm hover:bg-gray-50"
                  >
                    <Download size={17} />
                    Download{" "}
                    {currentSchedule.extension === "xlsx" ? "Excel" : "Word"}
                  </button>
                </div>
              ) : (
                <p className="mt-6 rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
                  No current schedule has been uploaded yet.
                </p>
              )}

              {currentSchedule && !currentConflict && (
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
                  Upload a .docx Word document, .xlsx Excel workbook, or .pdf
                  file. For best layout fidelity, export Excel schedules to PDF
                  in Excel before uploading. The current version will be
                  archived before it is replaced.
                </p>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <input
                    id="schedule-upload"
                    type="file"
                    accept=".docx,.xlsx,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf"
                    onChange={(event) =>
                      setSelectedFile(event.target.files?.[0] ?? null)
                    }
                    disabled={busy || currentConflict}
                    className="block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-gray-100 file:px-4 file:py-2.5 file:text-sm file:font-medium hover:file:bg-gray-200"
                  />
                  <button
                    type="button"
                    onClick={() => void uploadSchedule()}
                    disabled={busy || !selectedFile || currentConflict}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy ? (
                      <LoaderCircle className="animate-spin" size={17} />
                    ) : selectedFile &&
                      getScheduleExtension(selectedFile.name) === "xlsx" ? (
                      <FileSpreadsheet size={17} />
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
                      Previous Word, Excel, and PDF schedule versions
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
                        {file.name.toLowerCase().endsWith(".xlsx") ? (
                          <FileSpreadsheet
                            className="mt-1 shrink-0 text-green-600"
                            size={20}
                          />
                        ) : (
                          <FileText
                            className="mt-1 shrink-0 text-gray-400"
                            size={20}
                          />
                        )}
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
