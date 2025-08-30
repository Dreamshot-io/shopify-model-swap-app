import { Modal } from "@shopify/polaris";
import { useEffect, useMemo, useRef, useState } from "react";

export function ImagePreviewModal({
  url,
  baseUrl,
  onClose,
}: {
  url: string;
  baseUrl?: string | null;
  onClose: () => void;
}) {
  const [dividerPercent, setDividerPercent] = useState(50);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [beforeNatural, setBeforeNatural] = useState<{
    w: number;
    h: number;
  } | null>(null);
  const [afterNatural, setAfterNatural] = useState<{
    w: number;
    h: number;
  } | null>(null);

  const aspectRatioString = useMemo(() => {
    // Prefer matching the original (before) image ratio exactly
    if (beforeNatural) return `${beforeNatural.w} / ${beforeNatural.h}`;
    if (afterNatural) return `${afterNatural.w} / ${afterNatural.h}`;
    return "3 / 4"; // sensible default for product shots
  }, [beforeNatural, afterNatural]);

  function updateDividerFromClientX(clientX: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const percent = Math.min(
      100,
      Math.max(0, ((clientX - rect.left) / rect.width) * 100),
    );
    setDividerPercent(percent);
  }

  useEffect(() => {
    if (!dragging) return;

    function onMouseMove(e: MouseEvent) {
      updateDividerFromClientX(e.clientX);
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches && e.touches[0]) {
        updateDividerFromClientX(e.touches[0].clientX);
      }
    }

    function endDrag() {
      setDragging(false);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("touchend", endDrag);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("mouseup", endDrag);
      window.removeEventListener("touchend", endDrag);
    };
  }, [dragging]);

  return (
    <Modal
      open
      onClose={onClose}
      title="Preview"
      primaryAction={{ content: "Close", onAction: onClose }}
    >
      <div style={{ padding: 16 }}>
        {baseUrl ? (
          <div
            ref={containerRef}
            style={{ position: "relative", width: "100%", userSelect: "none" }}
            onMouseDown={(e) => {
              setDragging(true);
              updateDividerFromClientX(e.clientX);
            }}
            onTouchStart={(e) => {
              setDragging(true);
              if (e.touches && e.touches[0]) {
                updateDividerFromClientX(e.touches[0].clientX);
              }
            }}
          >
            {/* Maintain a stable aspect ratio so both images are scaled identically */}
            <div
              style={{
                position: "relative",
                width: "100%",
                aspectRatio: aspectRatioString,
                background: "white",
              }}
            />

            {/* Behind image (Before) filling container */}
            <img
              src={baseUrl}
              alt="Before"
              onLoad={(e) =>
                setBeforeNatural({
                  w: e.currentTarget.naturalWidth,
                  h: e.currentTarget.naturalHeight,
                })
              }
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: "center",
                display: "block",
                background: "white",
              }}
            />

            {/* Top layer (After) clipped to show only the right side */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                overflow: "hidden",
                // Show only the part to the right of the divider
                clipPath: `inset(0 0 0 ${dividerPercent}%)`,
                WebkitClipPath: `inset(0 0 0 ${dividerPercent}%)`,
              }}
            >
              <img
                src={url}
                alt="After"
                onLoad={(e) =>
                  setAfterNatural({
                    w: e.currentTarget.naturalWidth,
                    h: e.currentTarget.naturalHeight,
                  })
                }
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: "center",
                  display: "block",
                  background: "white",
                }}
              />
            </div>

            {/* Vertical handle */}
            <div
              role="separator"
              aria-label="Image comparison handle"
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${dividerPercent}%`,
                transform: "translateX(-1px)",
                width: 2,
                background: "rgba(255,255,255,0.9)",
                boxShadow: "0 0 0 1px rgba(0,0,0,0.2)",
                cursor: "ew-resize",
              }}
            >
              {/* Centered left/right arrows */}
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                width={30}
                height={30}
                style={{
                  position: "absolute",
                  top: "50%",
                  left: -52,
                  transform: "translateY(-50%)",
                  pointerEvents: "none",
                }}
              >
                <path
                  d="M15 6l-6 6 6 6"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                width={30}
                height={30}
                style={{
                  position: "absolute",
                  top: "50%",
                  right: -52,
                  transform: "translateY(-50%)",
                  pointerEvents: "none",
                }}
              >
                <path
                  d="M9 6l6 6-6 6"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        ) : (
          <img
            src={url}
            alt="Preview"
            style={{ width: "100%", height: "auto" }}
          />
        )}
      </div>
    </Modal>
  );
}
