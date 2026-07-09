import { useEffect, useState } from "react";
import {
  ActivityIcon,
  AlertTriangleIcon,
  CameraIcon,
  CheckIcon,
  DownloadIcon,
  FileInputIcon,
  ListChecksIcon,
  QrCodeIcon,
  RefreshCwIcon,
  ShieldIcon,
  XIcon,
} from "lucide-react";

import { api } from "@/api";
import { cn } from "@/lib/utils";
import { LiveCode } from "@/components/live-code";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { QrLoginScannerDialog } from "@/components/qr-login-scanner-dialog";
import type { Account, Role } from "@/types";

type SteamConfirmation = {
  type: number;
  type_name: string;
  id: string;
  creator_id: string;
  nonce: string;
  creation_time: number;
  cancel: string;
  accept: string;
  icon?: string;
  multi: boolean;
  headline: string;
  summary: string[];
};

type ConfirmationsPanelState = {
  accountId: string;
  accountName: string;
  confirmations: SteamConfirmation[];
};

type LoginSession = {
  clientId: string;
  ip?: string;
  geoloc?: string;
  city?: string;
  state?: string;
  country?: string;
  platformType?: number;
  deviceFriendlyName?: string;
  version?: number;
  loginHistory?: unknown;
  requestorLocationMismatch?: boolean;
  highUsageLogin?: boolean;
  requestedPersistence?: number;
};

type LoginSessionsPanelState = {
  accountId: string;
  accountName: string;
  sessions: LoginSession[];
};

type QrReviewState = {
  accountId: string;
  accountName: string;
  challengeUrl: string;
};

function confirmationSummary(confirmation: SteamConfirmation): string[] {
  return Array.isArray(confirmation.summary) ? confirmation.summary : [];
}

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

export function AccountsPanel({
  accounts,
  role,
  onRefresh,
}: {
  accounts: Account[];
  role: Role;
  onRefresh: () => Promise<void>;
}) {
  const [message, setMessage] = useState<
    { kind: "success" | "error"; title: string; description?: string } | null
  >(null);
  const [qrChallenges, setQrChallenges] = useState<Record<string, string>>({});
  const [exportAccount, setExportAccount] = useState<Account | null>(null);
  const [confirmationsPanel, setConfirmationsPanel] =
    useState<ConfirmationsPanelState | null>(null);
  const [loginSessionsPanel, setLoginSessionsPanel] =
    useState<LoginSessionsPanelState | null>(null);
  const [scanAccount, setScanAccount] = useState<Account | null>(null);
  const [qrDialogAccount, setQrDialogAccount] = useState<Account | null>(null);
  const [qrDialogError, setQrDialogError] = useState<string | null>(null);
  const [qrReview, setQrReview] = useState<QrReviewState | null>(null);
  const [qrReviewError, setQrReviewError] = useState<string | null>(null);
  const [qrReviewInfo, setQrReviewInfo] = useState<LoginSession | null>(null);
  const [qrReviewInfoLoading, setQrReviewInfoLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [maFile, setMaFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [downloadingExport, setDownloadingExport] = useState(false);
  const [confirmationBusy, setConfirmationBusy] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!qrReview) return;
    let cancelled = false;
    setQrReviewInfo(null);
    setQrReviewInfoLoading(true);
    (async () => {
      try {
        const data = await api<{ session: LoginSession }>(
          `/api/accounts/${qrReview.accountId}/login-sessions/challenge-info`,
          {
            method: "POST",
            body: JSON.stringify({ challengeUrl: qrReview.challengeUrl }),
          },
        );
        if (cancelled) return;
        setQrReviewInfo(data.session);
      } catch (err) {
        if (cancelled) return;
        setQrReviewError(
          err instanceof Error ? err.message : "Failed to look up Steam login info",
        );
      } finally {
        if (!cancelled) setQrReviewInfoLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qrReview]);

  function notifySuccess(title: string, description?: string) {
    setMessage({ kind: "success", title, description });
  }

  function notifyError(err: unknown, fallback: string) {
    const text = err instanceof Error ? err.message : fallback;
    setMessage({ kind: "error", title: fallback, description: text });
  }

  async function importMafile(event: React.FormEvent) {
    event.preventDefault();
    if (!maFile) return;
    setImporting(true);
    setMessage(null);
    try {
      const body = new FormData();
      body.append("maFile", maFile);
      await api("/api/accounts/import-mafile", {
        method: "POST",
        body,
      });
      setMaFile(null);
      setImportOpen(false);
      notifySuccess("maFile imported");
      await onRefresh();
    } catch (err) {
      notifyError(err, "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function listConfirmations(account: Account) {
    setMessage(null);
    setLoginSessionsPanel(null);
    try {
      const data = await api<{ confirmations: SteamConfirmation[] }>(
        `/api/accounts/${account.id}/confirmations`,
      );
      setConfirmationsPanel({
        accountId: account.id,
        accountName: account.accountName,
        confirmations: data.confirmations,
      });
    } catch (err) {
      notifyError(err, "Failed to load confirmations");
    }
  }

  async function listLoginSessions(account: Account) {
    setConfirmationsPanel(null);
    try {
      const data = await api<{ sessions: LoginSession[] }>(
        `/api/accounts/${account.id}/login-sessions`,
      );
      setLoginSessionsPanel({
        accountId: account.id,
        accountName: account.accountName,
        sessions: data.sessions,
      });
    } catch (err) {
      notifyError(err, "Failed to load login approvals");
    }
  }

  function setAccountQr(accountId: string, value: string) {
    setQrChallenges((current) => ({ ...current, [accountId]: value }));
  }

  function reviewQr(account: Account, challengeUrl: string) {
    const trimmed = challengeUrl.trim();
    if (!isSteamQrChallenge(trimmed)) {
      setQrDialogError("Paste or scan a URL like https://s.team/q/1/123456789.");
      return;
    }
    setMessage(null);
    setQrDialogError(null);
    setQrDialogAccount(null);
    setQrReview({
      accountId: account.id,
      accountName: account.accountName,
      challengeUrl: trimmed,
    });
  }

  function handleScannedQr(challengeUrl: string) {
    if (!scanAccount) return;
    setAccountQr(scanAccount.id, challengeUrl);
    setQrDialogError(null);
    setQrDialogAccount(null);
    setQrReview({
      accountId: scanAccount.id,
      accountName: scanAccount.accountName,
      challengeUrl,
    });
    setScanAccount(null);
  }

  async function submitLoginApproval(
    input: {
      accountId: string;
      accountName: string;
      challengeUrl?: string;
      clientId?: string;
      version?: number;
    },
    confirm: boolean,
    options: { source: "qrReview" | "sessions" } = { source: "sessions" },
  ) {
    const busyKey = `${input.accountId}:${input.challengeUrl || input.clientId}:${confirm ? "accept" : "deny"}`;
    setLoginBusy(busyKey);
    setMessage(null);
    if (options.source === "qrReview") setQrReviewError(null);
    try {
      await api(
        `/api/accounts/${input.accountId}/login-sessions/${confirm ? "approve" : "deny"}`,
        {
          method: "POST",
          body: JSON.stringify({
            challengeUrl: input.challengeUrl,
            clientId: input.clientId,
            version: input.version,
            confirm,
          }),
        },
      );
      notifySuccess(confirm ? "Login accepted" : "Login denied");
      setQrReview(null);
      setQrReviewError(null);
      if (input.challengeUrl) setAccountQr(input.accountId, "");
      if (loginSessionsPanel?.accountId === input.accountId) {
        await listLoginSessions({
          id: input.accountId,
          accountName: input.accountName,
          steamId: null,
          status: "active",
        });
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : "Login action failed";
      if (options.source === "qrReview") {
        setQrReviewError(text);
      } else {
        notifyError(err, "Login action failed");
      }
    } finally {
      setLoginBusy(null);
    }
  }

  async function actOnConfirmation(
    confirmation: SteamConfirmation,
    action: "accept" | "deny",
  ) {
    if (!confirmationsPanel) return;
    const key = `${confirmation.id}:${action}`;
    setConfirmationBusy(key);
    setMessage(null);
    try {
      await api(
        `/api/accounts/${confirmationsPanel.accountId}/confirmations/${confirmation.id}/${action}`,
        {
          method: "POST",
          body: JSON.stringify({ nonce: confirmation.nonce }),
        },
      );
      notifySuccess(
        action === "accept" ? "Confirmation accepted" : "Confirmation denied",
      );
      await listConfirmations({
        id: confirmationsPanel.accountId,
        accountName: confirmationsPanel.accountName,
        steamId: null,
        status: "active",
      });
    } catch (err) {
      notifyError(err, "Confirmation action failed");
    } finally {
      setConfirmationBusy(null);
    }
  }

  async function downloadExport() {
    if (!exportAccount) return;
    setDownloadingExport(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/accounts/${exportAccount.id}/export-mafile`,
        {
          headers: { Accept: "application/json" },
        },
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `${response.status} ${response.statusText}`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename =
        match?.[1] || `${exportAccount.accountName || "steam-account"}.maFile`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportAccount(null);
    } catch (err) {
      notifyError(err, "Export failed");
    } finally {
      setDownloadingExport(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Accounts</h2>
          <p className="text-sm text-muted-foreground">
            {role === "admin"
              ? "Manage imported authenticators."
              : "View assigned Steam Guard codes and handle login approvals."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void onRefresh()}
          >
            <RefreshCwIcon />
            Refresh
          </Button>
          {role === "admin" ? (
            <Dialog open={importOpen} onOpenChange={setImportOpen}>
              <DialogTrigger asChild>
                <Button type="button">
                  <FileInputIcon />
                  Import maFile
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Upload plaintext maFile</DialogTitle>
                  <DialogDescription>
                    Choose a single .maFile export. The server encrypts it
                    before writing to D1.
                  </DialogDescription>
                </DialogHeader>
                <form
                  onSubmit={(event) => void importMafile(event)}
                  className="flex flex-col gap-4"
                >
                  <Card className="border-destructive/30 bg-destructive/5">
                    <CardContent className="flex gap-3 pt-4 text-sm text-destructive">
                      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                      <p>
                        The selected file is plaintext high-sensitivity backup
                        material. Upload only files you trust.
                      </p>
                    </CardContent>
                  </Card>
                  <Field>
                    <FieldLabel htmlFor="mafile-upload">maFile</FieldLabel>
                    <Input
                      id="mafile-upload"
                      type="file"
                      accept=".maFile,.mafile,.json,application/json"
                      onChange={(event) =>
                        setMaFile(event.target.files?.[0] ?? null)
                      }
                    />
                    <FieldDescription>
                      {maFile ? maFile.name : "No file selected."}
                    </FieldDescription>
                  </Field>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setImportOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={!maFile || importing}>
                      {importing ? "Importing" : "Import"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>
      </div>

      {message ? (
        <Alert
          variant={message.kind === "error" ? "destructive" : "default"}
        >
          {message.kind === "error" ? (
            <AlertTriangleIcon />
          ) : (
            <CheckIcon />
          )}
          <AlertTitle>{message.title}</AlertTitle>
          {message.description ? (
            <AlertDescription>{message.description}</AlertDescription>
          ) : null}
        </Alert>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-2">
        {accounts.map((account) => (
          <Card key={account.id} className="gap-4">
            <CardHeader className="gap-1">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="truncate text-lg">
                    {account.accountName}
                  </CardTitle>
                  <CardDescription className="font-mono text-xs">
                    {account.steamId || "Steam ID unavailable"}
                  </CardDescription>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "gap-1.5",
                    account.status === "active"
                      ? "border-guard/30 text-guard"
                      : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      account.status === "active"
                        ? "bg-guard"
                        : "bg-muted-foreground",
                    )}
                  />
                  {account.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <LiveCode accountId={account.id} />
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => void listLoginSessions(account)}
                >
                  <ActivityIcon />
                  Logins
                </Button>
                {role === "admin" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => void listConfirmations(account)}
                  >
                    <ListChecksIcon />
                    Confirmations
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setQrDialogError(null);
                    setQrDialogAccount(account);
                  }}
                >
                  <QrCodeIcon />
                  Approve QR
                </Button>
                {role === "admin" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-muted-foreground hover:text-destructive"
                    onClick={() => setExportAccount(account)}
                  >
                    <DownloadIcon />
                    Export
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
        {accounts.length === 0 ? (
          <Card className="xl:col-span-2">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <ShieldIcon className="size-6" />
              </div>
              <div>
                <p className="font-medium">No accounts yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {role === "admin"
                    ? "Import a maFile or run Steam setup to add your first authenticator."
                    : "An admin has not assigned any accounts to you yet."}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Dialog
        open={Boolean(qrDialogAccount)}
        onOpenChange={(open) => {
          if (!open) {
            setQrDialogAccount(null);
            setQrDialogError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve a QR login</DialogTitle>
            <DialogDescription>
              {qrDialogAccount?.accountName} — scan the QR code on the Steam
              login screen or paste its URL, then review the request before
              accepting.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              placeholder="https://s.team/q/..."
              value={
                qrDialogAccount ? qrChallenges[qrDialogAccount.id] || "" : ""
              }
              onChange={(event) => {
                if (qrDialogAccount)
                  setAccountQr(qrDialogAccount.id, event.target.value);
              }}
            />
            {qrDialogError ? (
              <p className="text-sm text-destructive">{qrDialogError}</p>
            ) : null}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() =>
                  qrDialogAccount && setScanAccount(qrDialogAccount)
                }
              >
                <CameraIcon />
                Scan QR
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={
                  !qrDialogAccount ||
                  !qrChallenges[qrDialogAccount.id]?.trim()
                }
                onClick={() =>
                  qrDialogAccount &&
                  reviewQr(
                    qrDialogAccount,
                    qrChallenges[qrDialogAccount.id] || "",
                  )
                }
              >
                <QrCodeIcon />
                Review login
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {loginSessionsPanel ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Login approvals</CardTitle>
                <CardDescription>
                  {loginSessionsPanel.accountName} ·{" "}
                  {loginSessionsPanel.sessions.length} pending
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  void listLoginSessions({
                    id: loginSessionsPanel.accountId,
                    accountName: loginSessionsPanel.accountName,
                    steamId: null,
                    status: "active",
                  })
                }
              >
                <RefreshCwIcon />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {loginSessionsPanel.sessions.length === 0 ? (
              <div className="rounded-lg border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                No pending Steam login approvals for this account.
              </div>
            ) : (
              loginSessionsPanel.sessions.map((session) => (
                <div
                  key={session.clientId}
                  className="flex flex-col gap-3 rounded-lg border bg-background p-4 md:flex-row md:items-start md:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">
                        client {session.clientId}
                      </Badge>
                      <span className="font-medium">
                        {session.deviceFriendlyName || "Steam login request"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {[
                        session.ip,
                        session.city,
                        session.state,
                        session.country,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Location unavailable"}
                    </p>
                    <p className="mt-2 font-mono text-xs text-muted-foreground">
                      version {session.version ?? 1}
                      {session.platformType !== undefined
                        ? ` · platform ${session.platformType}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={loginBusy !== null}
                      onClick={() =>
                        void submitLoginApproval(
                          {
                            accountId: loginSessionsPanel.accountId,
                            accountName: loginSessionsPanel.accountName,
                            clientId: session.clientId,
                            version: session.version ?? 1,
                          },
                          true,
                        )
                      }
                    >
                      <CheckIcon />
                      Accept
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={loginBusy !== null}
                      onClick={() =>
                        void submitLoginApproval(
                          {
                            accountId: loginSessionsPanel.accountId,
                            accountName: loginSessionsPanel.accountName,
                            clientId: session.clientId,
                            version: session.version ?? 1,
                          },
                          false,
                        )
                      }
                    >
                      <XIcon />
                      Deny
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}

      {qrReview ? (
        <AlertDialog
          open={Boolean(qrReview)}
          onOpenChange={(open) => {
            if (!open) {
              setQrReview(null);
              setQrReviewError(null);
              setQrReviewInfo(null);
              setQrReviewInfoLoading(false);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Review Steam QR login?</AlertDialogTitle>
              <AlertDialogDescription>
                Account: {qrReview.accountName}. Only accept this login if the
                QR code came from your own Steam login screen.
              </AlertDialogDescription>
            </AlertDialogHeader>

            {qrReviewInfoLoading ? (
              <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                Looking up login details from Steam…
              </div>
            ) : qrReviewInfo ? (
              <div className="flex flex-col gap-2 rounded-lg border bg-background p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    client {qrReviewInfo.clientId}
                  </Badge>
                  <span className="font-medium">
                    {qrReviewInfo.deviceFriendlyName || "Steam login request"}
                  </span>
                  {qrReviewInfo.highUsageLogin ? (
                    <Badge variant="destructive">high-usage</Badge>
                  ) : null}
                  {qrReviewInfo.requestorLocationMismatch ? (
                    <Badge variant="destructive">location mismatch</Badge>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground">
                  {[
                    qrReviewInfo.ip,
                    qrReviewInfo.city,
                    qrReviewInfo.state,
                    qrReviewInfo.country,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Location unavailable"}
                </p>
                {qrReviewInfo.geoloc ? (
                  <p className="text-xs text-muted-foreground">
                    geo {qrReviewInfo.geoloc}
                  </p>
                ) : null}
                <p className="font-mono text-xs text-muted-foreground">
                  version {qrReviewInfo.version ?? 1}
                  {qrReviewInfo.platformType !== undefined
                    ? ` · platform ${qrReviewInfo.platformType}`
                    : ""}
                </p>
              </div>
            ) : null}

            <div className="rounded-lg border bg-muted/30 p-3 font-mono text-xs break-all text-muted-foreground">
              {qrReview.challengeUrl}
            </div>
            {qrReviewError ? (
              <Alert variant="destructive">
                <AlertTriangleIcon />
                <AlertTitle>Steam rejected this challenge</AlertTitle>
                <AlertDescription>{qrReviewError}</AlertDescription>
              </Alert>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button
                type="button"
                variant="outline"
                disabled={loginBusy !== null}
                onClick={() =>
                  void submitLoginApproval(qrReview, false, { source: "qrReview" })
                }
              >
                <XIcon />
                Deny login
              </Button>
              <Button
                type="button"
                disabled={loginBusy !== null}
                onClick={() =>
                  void submitLoginApproval(qrReview, true, { source: "qrReview" })
                }
              >
                <CheckIcon />
                Accept login
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      {confirmationsPanel ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Confirmations</CardTitle>
                <CardDescription>
                  {confirmationsPanel.accountName} ·{" "}
                  {confirmationsPanel.confirmations.length} pending
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  void listConfirmations({
                    id: confirmationsPanel.accountId,
                    accountName: confirmationsPanel.accountName,
                    steamId: null,
                    status: "active",
                  })
                }
              >
                <RefreshCwIcon />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {confirmationsPanel.confirmations.length === 0 ? (
              <div className="rounded-lg border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                No pending Steam mobile confirmations for this account.
              </div>
            ) : (
              confirmationsPanel.confirmations.map((confirmation) => (
                <div
                  key={confirmation.id}
                  className="flex flex-col gap-3 rounded-lg border bg-background p-4 md:flex-row md:items-start md:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">
                        {confirmation.type_name || `type ${confirmation.type}`}
                      </Badge>
                      <span className="font-medium">
                        {confirmation.headline || confirmation.id}
                      </span>
                    </div>
                    {confirmationSummary(confirmation).length ? (
                      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                        {confirmationSummary(confirmation).map((line) => (
                          <p key={line}>{line}</p>
                        ))}
                      </div>
                    ) : null}
                    <p className="mt-2 font-mono text-xs text-muted-foreground">
                      id {confirmation.id}
                      {confirmation.creator_id
                        ? ` · creator ${confirmation.creator_id}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={confirmationBusy !== null}
                      onClick={() =>
                        void actOnConfirmation(confirmation, "accept")
                      }
                    >
                      <CheckIcon />
                      Accept
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={confirmationBusy !== null}
                      onClick={() =>
                        void actOnConfirmation(confirmation, "deny")
                      }
                    >
                      <XIcon />
                      Deny
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}

      <QrLoginScannerDialog
        accountName={scanAccount?.accountName || ""}
        open={Boolean(scanAccount)}
        onOpenChange={(open) => {
          if (!open) setScanAccount(null);
        }}
        onDetected={handleScannedQr}
      />

      <AlertDialog
        open={Boolean(exportAccount)}
        onOpenChange={(open) => !open && setExportAccount(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Download plaintext maFile?</AlertDialogTitle>
            <AlertDialogDescription>
              This file is a high-sensitivity backup for{" "}
              {exportAccount?.accountName}. Store it offline and delete extra
              copies.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void downloadExport()}
              disabled={downloadingExport}
            >
              {downloadingExport ? "Downloading" : "Download"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
