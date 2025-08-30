import { Modal } from "@shopify/polaris";

export function ImagePreviewModal({
  url,
  baseUrl,
  onClose,
}: {
  url: string;
  baseUrl?: string | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title="Preview"
      primaryAction={{ content: "Close", onAction: onClose }}
    >
      <div style={{ padding: 16 }}>
        {baseUrl ? (
          <div style={{ position: "relative", width: "100%" }}>
            <div style={{ position: "relative" }}>
              <img
                src={baseUrl}
                alt="Original"
                style={{ width: "100%", height: "auto", display: "block" }}
              />
              <div
                id="compare-overlay"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "50%",
                  overflow: "hidden",
                }}
              >
                <img
                  src={url}
                  alt="Generated"
                  style={{ width: "100%", height: "auto", display: "block" }}
                />
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              defaultValue={50}
              onChange={(e) => {
                const percent = Number(e.currentTarget.value);
                const overlay = document.getElementById("compare-overlay");
                if (overlay) overlay.style.width = `${percent}%`;
              }}
              style={{ width: "100%", marginTop: 12 }}
            />
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
