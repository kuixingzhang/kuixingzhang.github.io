"use client";

import { useEffect, useRef, useState } from "react";
import { ReactPptxViewer, usePptxViewer } from "@extend-ai/react-pptx";
import "@extend-ai/react-pptx/styles.css";

type TeachingMaterialPreviewProps = {
  url: string;
  fileName: string;
  onClose: () => void;
  inline?: boolean;
};

export default function TeachingMaterialPreview({
  url,
  fileName,
  onClose,
  inline = false,
}: TeachingMaterialPreviewProps) {
  const wordRef = useRef<HTMLDivElement>(null);
  const pptViewer = usePptxViewer();
  const fileBlobRef = useRef<Blob | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(100);
  const [fileUrl, setFileUrl] = useState("");
  const [pptxFile, setPptxFile] = useState<Blob | null>(null);
  const pptViewerContainerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";

  useEffect(() => {
    if (extension !== "pptx" || !isFullscreen) return;

    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;

      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return;
      }

      const controller = pptViewer.controller;
      if (!controller) return;

      const currentIndex = controller.getSlideIndex();

      if (
        event.key === "ArrowRight" ||
        event.key === "ArrowDown" ||
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        void controller.goToSlide(currentIndex + 1);
      } else if (
        event.key === "ArrowLeft" ||
        event.key === "ArrowUp" ||
        event.key === "Backspace"
      ) {
        event.preventDefault();
        void controller.goToSlide(Math.max(0, currentIndex - 1));
      } else if (event.key === "Escape") {
        // Let the browser handle Escape to exit fullscreen.
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [extension, isFullscreen, pptViewer.controller]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";

    async function loadPreview() {
      setLoading(true);
      setError("");
      setFileUrl("");
      setPptxFile(null);
      fileBlobRef.current = null;

      if (wordRef.current) {
        wordRef.current.replaceChildren();
      }

      try {
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error("Unable to retrieve this file.");
        }

        const blob = await response.blob();

        if (cancelled) return;

        fileBlobRef.current = blob;
        objectUrl = URL.createObjectURL(blob);
        setFileUrl(objectUrl);

        if (extension === "pdf") {
          setLoading(false);
          return;
        }

        if (extension === "docx") {
          const docx = await import("docx-preview");

          if (cancelled || !wordRef.current) return;

          wordRef.current.replaceChildren();

          await docx.renderAsync(blob, wordRef.current, wordRef.current, {
            className: "docx-preview",
            inWrapper: true,
          });
        } else if (extension === "pptx") {
          setPptxFile(blob);
        } else {
          throw new Error(
            "Preview is supported for PDF, DOCX, and PPTX files.",
          );
        }

        if (!cancelled) {
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Preview failed. Please download the file.",
          );
          setLoading(false);
        }
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [url, extension]);

  async function toggleSlideshow() {
    const container = pptViewerContainerRef.current;

    if (!container) return;

    try {
      if (document.fullscreenElement === container) {
        await document.exitFullscreen();
      } else {
        await container.requestFullscreen();
      }
    } catch (err) {
      console.error("Fullscreen failed:", err);
      setError("Unable to enter fullscreen mode. Please try again.");
    }
  }

  useEffect(() => {
    function handleFullscreenChange() {
      const fullscreen =
        document.fullscreenElement === pptViewerContainerRef.current;

      setIsFullscreen(fullscreen);

      if (!fullscreen) return;

      // Wait for the browser and React to finish the fullscreen layout.
      requestAnimationFrame(() => {
        requestAnimationFrame(async () => {
          const controller = pptViewer.controller;
          const container = pptViewerContainerRef.current;
          const viewport =
            container?.querySelector<HTMLElement>(".rpv-viewport");

          if (!controller || !container || !viewport) return;

          console.log("Fullscreen container:", {
            width: container.clientWidth,
            height: container.clientHeight,
          });

          console.log("PPT viewport:", {
            width: viewport.clientWidth,
            height: viewport.clientHeight,
          });

          await controller.setZoom("fit-page");

          console.log("PPT zoom mode after fullscreen:", controller.getZoom());
          console.log(
            "PPT resolved zoom after fullscreen:",
            controller.getResolvedZoom(),
          );
        });
      });
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [pptViewer.controller]);

  function downloadFile() {
    if (!fileBlobRef.current) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    const downloadUrl = URL.createObjectURL(fileBlobRef.current);
    const link = document.createElement("a");

    link.href = downloadUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  }

  function printFile() {
    if (extension === "pdf") {
      window.open(fileUrl || url, "_blank", "noopener,noreferrer");
      return;
    }

    if (extension === "docx" && wordRef.current) {
      const printWindow = window.open("", "_blank");

      if (!printWindow) {
        setError("Please allow pop-ups to print this document.");
        return;
      }

      const documentHtml = wordRef.current.innerHTML;

      const styles = Array.from(document.querySelectorAll("style"))
        .map((style) => style.outerHTML)
        .join("\n");

      printWindow.document.open();
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8" />
            <title>${fileName.replace(/[<>&"]/g, "")}</title>
            ${styles}
            <style>
              @page {
                size: auto;
                margin: 15mm;
              }

              html, body {
                margin: 0;
                padding: 0;
                background: white !important;
                color: black;
              }

              .docx-wrapper {
                background: white !important;
                padding: 0 !important;
                margin: 0 !important;
              }

              .docx {
                margin: 0 auto !important;
                box-shadow: none !important;
              }

              body {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
            </style>
          </head>
          <body>${documentHtml}</body>
        </html>
      `);
      printWindow.document.close();

      printWindow.onload = () => {
        printWindow.focus();
        printWindow.print();
      };

      return;
    }

    if (extension === "pptx") {
      setError(
        "For reliable PowerPoint printing, download the original PPTX and print it from PowerPoint.",
      );
      return;
    }

    window.print();
  }

  function changeZoom(amount: number) {
    setZoom((current) => Math.min(200, Math.max(50, current + amount)));
  }

  return (
    <div
      className={
        inline
          ? "preview-overlay flex w-full flex-col overflow-hidden rounded-xl border bg-white"
          : "preview-overlay fixed inset-0 z-50 flex flex-col bg-white"
      }
    >
      <header className="preview-toolbar flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{fileName}</h2>
          <p className="text-sm text-gray-500">Document Preview</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={downloadFile}
            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-100"
          >
            Download
          </button>

          <button
            type="button"
            onClick={printFile}
            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-100"
          >
            Print
          </button>

          {extension === "pptx" && (
            <button
              type="button"
              onClick={() => void toggleSlideshow()}
              className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-100"
            >
              {isFullscreen ? "Exit Slideshow" : "Start Slideshow"}
            </button>
          )}

          {extension !== "pptx" && (
            <div className="flex items-center gap-1 rounded-lg border p-1">
              <button
                type="button"
                onClick={() => changeZoom(-10)}
                disabled={zoom <= 50}
                aria-label="Zoom out"
                className="rounded px-2 py-1 text-lg hover:bg-gray-100 disabled:opacity-40"
              >
                −
              </button>

              <button
                type="button"
                onClick={() => setZoom(100)}
                className="min-w-14 px-1 py-1 text-sm hover:bg-gray-100"
                title="Reset zoom"
              >
                {zoom}%
              </button>

              <button
                type="button"
                onClick={() => changeZoom(10)}
                disabled={zoom >= 200}
                aria-label="Zoom in"
                className="rounded px-2 py-1 text-lg hover:bg-gray-100 disabled:opacity-40"
              >
                +
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-4 py-2 hover:bg-gray-100"
          >
            Close
          </button>
        </div>
      </header>

      <main
        className={`preview-content min-h-0 flex-1 overflow-auto bg-gray-100 p-4 ${
          inline ? "max-h-[75vh]" : ""
        }`}
      >
        {loading && (
          <p className="py-8 text-center text-gray-600">Loading preview...</p>
        )}

        {error && (
          <div className="mx-auto mb-4 max-w-2xl rounded-lg border bg-white p-6 text-center">
            <p className="text-red-600">{error}</p>
            <p className="mt-2 text-sm text-gray-600">
              You can download the original file instead.
            </p>
            <button
              type="button"
              onClick={() => setError("")}
              className="mt-3 rounded-lg border px-3 py-2 text-sm hover:bg-gray-100"
            >
              Dismiss
            </button>
          </div>
        )}

        {extension === "pdf" && fileUrl && (
          <iframe
            src={fileUrl}
            title={fileName}
            className="h-full min-h-[70vh] w-full rounded border bg-white"
          />
        )}

        {extension === "docx" && (
          <div
            style={{ zoom: `${zoom}%` }}
            className="mx-auto max-w-5xl overflow-auto bg-white p-6 shadow"
          >
            <div ref={wordRef} />
          </div>
        )}

        {extension === "pptx" && pptxFile && (
          <div
            ref={pptViewerContainerRef}
            className={`ppt-viewer-fullscreen ${
              isFullscreen
                ? "fixed inset-0 z-[100] h-screen w-screen max-w-none"
                : "mx-auto h-[calc(100vh-150px)] min-h-[500px] w-full max-w-7xl"
            } overflow-hidden bg-white`}
          >
            <ReactPptxViewer
              key={`${fileName}-${pptxFile.size}`}
              ref={pptViewer.ref}
              source={pptxFile}
              mode="slide"
              height={isFullscreen ? "100vh" : "min(76vh, 780px)"}
              zoom={isFullscreen ? "fit-page" : "fit-width"}
              showThumbnails={!isFullscreen}
              showToolbar={!isFullscreen}
              showDiagnostics={!isFullscreen}
              showNotes={false}
              showSlideLabels={false}
              onReady={(controller) => {
                (window as any).__pptController = controller;
                console.log("PPT controller ready");
              }}
              onLoad={(presentation) => {
                const size = presentation.document.size;

                console.log("PPT original size:", {
                  widthEmu: size.widthEmu,
                  heightEmu: size.heightEmu,
                  aspectRatio: size.widthEmu / size.heightEmu,
                });
              }}
              onWarning={(warning) => {
                console.warn("PowerPoint preview warning:", warning);
              }}
            />
          </div>
        )}

        {["doc", "ppt"].includes(extension) && (
          <div className="rounded-lg bg-white p-6 text-center">
            <p>Older DOC and PPT formats are not supported by this preview.</p>
            <p className="mt-2 text-sm text-gray-600">
              Please download the file or convert it to DOCX, PPTX, or PDF.
            </p>
          </div>
        )}
      </main>
      <style jsx global>{`
        .ppt-viewer-fullscreen:fullscreen {
          position: fixed;
          inset: 0;
          width: 100vw;
          height: 100vh;
          max-width: none;
          min-height: 0;
          margin: 0;
          padding: 0;
          background: #000;
          overflow: hidden;
        }

        .ppt-viewer-fullscreen:fullscreen .rpv-root {
          width: 100% !important;
          height: 100% !important;
          min-height: 0 !important;
          max-height: none !important;
          background: #000 !important;
        }

        .ppt-viewer-fullscreen:fullscreen .rpv-workspace {
          display: flex !important;
          width: 100% !important;
          height: 100% !important;
          min-height: 0 !important;
          max-height: none !important;
        }

        .ppt-viewer-fullscreen:fullscreen .rpv-stage {
          flex: 1 1 auto !important;
          width: 100% !important;
          height: 100% !important;
          min-height: 0 !important;
          background: #000 !important;
          overflow: hidden !important;
        }

        .ppt-viewer-fullscreen:fullscreen .rpv-viewport {
          width: 100% !important;
          height: 100% !important;
          min-height: 0 !important;
          max-height: none !important;
          padding: 0 !important;
          overflow: hidden !important;
          background: #000 !important;
        }

        .ppt-viewer-fullscreen:fullscreen .rpv-stage {
          background: #000 !important;
        }
      `}</style>
    </div>
  );
}
