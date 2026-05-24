import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { CameraIcon, QrCodeIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const SCAN_INTERVAL_MS = 150;

function isSteamQrChallenge(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.hostname === "s.team" && /^\/q\/\d+\/\d+$/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

export function QrLoginScannerDialog({
  accountName,
  open,
  onOpenChange,
  onDetected,
}: {
  accountName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDetected: (url: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onDetectedRef = useRef(onDetected);
  const [manualUrl, setManualUrl] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function startScanner() {
      setManualUrl("");
      setScanError(null);
      setScanning(true);

      if (!navigator.mediaDevices?.getUserMedia) {
        setScanning(false);
        setScanError(
          "Camera access is not available in this browser. Paste the Steam QR URL instead.",
        );
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (err) {
        if (cancelled) return;
        setScanning(false);
        if (
          err instanceof DOMException &&
          (err.name === "NotAllowedError" || err.name === "SecurityError")
        ) {
          setScanError(
            "Camera permission denied. Allow camera access in your browser settings, or paste the QR URL below.",
          );
        } else if (err instanceof DOMException && err.name === "NotFoundError") {
          setScanError(
            "No camera found on this device. Paste the QR URL below instead.",
          );
        } else {
          setScanError(err instanceof Error ? err.message : "Camera unavailable.");
        }
        return;
      }

      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      video.srcObject = stream;
      try {
        await video.play();
      } catch (err) {
        if (cancelled) return;
        setScanning(false);
        setScanError(
          err instanceof Error ? err.message : "Unable to start camera preview.",
        );
        return;
      }

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        setScanning(false);
        setScanError("Canvas 2D is not available in this browser.");
        return;
      }

      const tick = () => {
        if (cancelled) return;
        const v = videoRef.current;
        if (!v || v.readyState < v.HAVE_ENOUGH_DATA || v.videoWidth === 0) {
          timeoutId = setTimeout(tick, SCAN_INTERVAL_MS);
          return;
        }
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        let imageData: ImageData;
        try {
          imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        } catch {
          // Some browsers throw before the first decoded frame is ready.
          timeoutId = setTimeout(tick, SCAN_INTERVAL_MS);
          return;
        }
        const code = jsQR(
          imageData.data,
          imageData.width,
          imageData.height,
          { inversionAttempts: "dontInvert" },
        );
        if (code?.data && isSteamQrChallenge(code.data)) {
          onDetectedRef.current(code.data);
          onOpenChange(false);
          return;
        }
        timeoutId = setTimeout(tick, SCAN_INTERVAL_MS);
      };

      setScanning(false);
      tick();
    }

    void startScanner();

    return () => {
      cancelled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [open, onOpenChange]);

  function submitManualUrl(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = manualUrl.trim();
    if (!isSteamQrChallenge(trimmed)) {
      setScanError("Paste a Steam QR URL like https://s.team/q/1/123456789.");
      return;
    }
    onDetected(trimmed);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Scan Steam QR login</DialogTitle>
          <DialogDescription>
            Scan the QR shown by Steam for {accountName}. You will review it
            before accepting or denying.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-hidden rounded-lg border bg-muted/30">
          <video
            ref={videoRef}
            className="aspect-video w-full bg-background object-cover"
            muted
            playsInline
            autoPlay
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {scanning ? (
            <CameraIcon className="size-4" />
          ) : (
            <QrCodeIcon className="size-4" />
          )}
          <span>
            {scanning
              ? "Starting camera"
              : "Point the camera at the Steam QR code."}
          </span>
        </div>
        {scanError ? (
          <p className="text-sm text-destructive">{scanError}</p>
        ) : null}

        <form onSubmit={submitManualUrl} className="flex flex-col gap-3">
          <Field>
            <FieldLabel>Steam QR URL</FieldLabel>
            <Input
              placeholder="https://s.team/q/..."
              value={manualUrl}
              onChange={(event) => setManualUrl(event.target.value)}
            />
            <FieldDescription>
              Use this if camera scanning is unavailable.
            </FieldDescription>
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!manualUrl.trim()}>
              Review login
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
