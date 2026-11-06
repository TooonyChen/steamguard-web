import { useEffect, useMemo, useState } from "react";
import {
  ActivityIcon,
  AlertTriangleIcon,
  CameraIcon,
  CheckIcon,
  ChevronRightIcon,
  DownloadIcon,
  ListChecksIcon,
  MoreHorizontalIcon,
  QrCodeIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";

import { api } from "@/api";
import { cn } from "@/lib/utils";
import { LiveCode } from "@/components/live-code";
import { PageHeader } from "@/components/page-header";
import { useIsMobile } from "@/hooks/use-mobile";
import { needsSignin } from "@/hooks/use-signin-statuses";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import type { Account, Role, SteamLoginStatus } from "@/types";

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
  confirmations: SteamConfirmation[] | null;
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
  sessions: LoginSession[] | null;
};

type QrReviewState = {
  accountId: string;
  accountName: string;
  challengeUrl: string;
};

type MessageState = {
  kind: "success" | "error";
  title: string;
  description?: string;
};

type PanelLoadOptions = {
  clearMessage?: boolean;
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

const AVATAR_TONES = [
  "bg-guard/15 text-guard",
  "bg-[#8b95f0]/15 text-[#aeb6f5]",
  "bg-[#8fc47f]/15 text-[#a9d39b]",
  "bg-[#e0a36a]/15 text-[#e8bb8f]",
];

function avatarTone(account: Account) {
  let hash = 0;
  for (const char of account.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

function AccountAvatar({ account }: { account: Account }) {
  const disabled = account.status !== "active";
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const avatarUrl =
    account.avatarUrl && account.avatarUrl !== failedUrl ? account.avatarUrl : null;
  const box = "size-9 shrink-0 rounded-[10px] md:size-10";

  if (avatarUrl) {
    return (
      <img
        aria-hidden
        alt=""
        src={avatarUrl}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        draggable={false}
        onError={() => setFailedUrl(avatarUrl)}
        className={cn(box, "bg-secondary object-cover", disabled && "opacity-50 grayscale")}
      />
    );
  }

  return (
    <div
      aria-hidden
      className={cn(
        box,
        "flex items-center justify-center font-semibold",
        disabled ? "bg-secondary text-subtle" : avatarTone(account),
      )}
    >
      {account.accountName.slice(0, 1).toUpperCase()}
    </div>
  );
}

type AccountAction = "qr" | "logins" | "confirmations" | "export";

/** The row's "More" menu: a dropdown on desktop, a bottom sheet on phones. */
function AccountActionsMenu({
  account,
  role,
  isMobile,
  onAction,
}: {
  account: Account;
  role: Role;
  isMobile: boolean;
  onAction: (action: AccountAction) => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="text-muted-foreground"
      aria-label={`Actions for ${account.accountName}`}
      onClick={isMobile ? () => setSheetOpen(true) : undefined}
    >
      <MoreHorizontalIcon />
    </Button>
  );

  if (!isMobile) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 p-1.5">
          <DropdownMenuItem className="h-9" onSelect={() => onAction("qr")}>
            <QrCodeIcon />
            Scan QR to sign in
          </DropdownMenuItem>
          <DropdownMenuItem className="h-9" onSelect={() => onAction("logins")}>
            <ActivityIcon />
            Login requests
          </DropdownMenuItem>
          {role === "admin" ? (
            <>
              <DropdownMenuItem className="h-9" onSelect={() => onAction("confirmations")}>
                <ListChecksIcon />
                Trade and market confirmations
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                className="h-9"
                onSelect={() => onAction("export")}
              >
                <DownloadIcon />
                Export full .maFile
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  function pick(action: AccountAction) {
    setSheetOpen(false);
    onAction(action);
  }

  const rowClass =
    "flex min-h-14 w-full items-center gap-3.5 px-4 text-left text-[15px]";
  return (
    <>
      {trigger}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="pb-safe gap-4 rounded-t-[22px] border-0 bg-card px-4 pt-2.5"
        >
          <div aria-hidden className="mx-auto h-[5px] w-9 rounded-full bg-muted" />
          <SheetHeader className="flex-row items-center gap-3 p-0 px-1">
            <AccountAvatar account={account} />
            <div className="min-w-0">
              <SheetTitle className="truncate text-[17px]">{account.accountName}</SheetTitle>
              <SheetDescription className="font-mono text-xs">
                {account.steamId || "Steam ID unknown"}
              </SheetDescription>
            </div>
          </SheetHeader>
          <div className="flex flex-col overflow-hidden rounded-2xl bg-secondary">
            <button type="button" className={rowClass} onClick={() => pick("qr")}>
              <QrCodeIcon className="size-5 text-guard" />
              <span className="flex-1">Scan QR to sign in</span>
              <ChevronRightIcon className="size-4 text-subtle" />
            </button>
            <button type="button" className={cn(rowClass, "border-t")} onClick={() => pick("logins")}>
              <ActivityIcon className="size-5 text-guard" />
              <span className="flex-1">Login requests</span>
              <ChevronRightIcon className="size-4 text-subtle" />
            </button>
            {role === "admin" ? (
              <button
                type="button"
                className={cn(rowClass, "border-t")}
                onClick={() => pick("confirmations")}
              >
                <ListChecksIcon className="size-5 text-guard" />
                <span className="flex-1">Trade and market confirmations</span>
                <ChevronRightIcon className="size-4 text-subtle" />
              </button>
            ) : null}
          </div>
          {role === "admin" ? (
            <button
              type="button"
              onClick={() => pick("export")}
              className="flex items-start gap-3.5 rounded-2xl bg-secondary px-4 py-3.5 text-left text-destructive"
            >
              <DownloadIcon className="mt-0.5 size-5 shrink-0" />
              <span className="flex flex-col gap-0.5">
                <span className="text-[15px] font-medium">Export full .maFile</span>
                <span className="text-[13px] leading-[18px] text-destructive/80">
                  Plaintext secrets, including the revocation code. Anyone with this file
                  controls the account.
                </span>
              </span>
            </button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="mb-2 rounded-2xl"
            onClick={() => setSheetOpen(false)}
          >
            Close
          </Button>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function AccountsPanel({
  accounts,
  role,
  signinStatuses,
  onRefresh,
  onOpenSignins,
}: {
  accounts: Account[];
  role: Role;
  /** Stored Steam sign-in status per account; admins only (empty for viewers). */
  signinStatuses: Record<string, SteamLoginStatus>;
  onRefresh: () => Promise<void>;
  onOpenSignins: () => void;
}) {
  const isMobile = useIsMobile();
  const [filter, setFilter] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<MessageState | null>(null);
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

  async function listConfirmations(
    account: Account,
    options: PanelLoadOptions = {},
  ) {
    if (options.clearMessage !== false) setMessage(null);
    setLoginSessionsPanel(null);
    setConfirmationsPanel({
      accountId: account.id,
      accountName: account.accountName,
      confirmations: null,
    });
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
      setConfirmationsPanel(null);
      notifyError(err, "Failed to load confirmations");
    }
  }

  async function listLoginSessions(
    account: Account,
    options: PanelLoadOptions = {},
  ) {
    if (options.clearMessage !== false) setMessage(null);
    setConfirmationsPanel(null);
    setLoginSessionsPanel({
      accountId: account.id,
      accountName: account.accountName,
      sessions: null,
    });
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
      setLoginSessionsPanel(null);
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
        await listLoginSessions(
          {
            id: input.accountId,
            accountName: input.accountName,
            steamId: null,
            status: "active",
          },
          { clearMessage: false },
        );
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
      await listConfirmations(
        {
          id: confirmationsPanel.accountId,
          accountName: confirmationsPanel.accountName,
          steamId: null,
          status: "active",
        },
        { clearMessage: false },
      );
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

  const pageMessage = confirmationsPanel || loginSessionsPanel ? null : message;

  const visibleAccounts = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return accounts;
    return accounts.filter(
      (account) =>
        account.accountName.toLowerCase().includes(query) ||
        (account.steamId ?? "").includes(query),
    );
  }, [accounts, filter]);

  const activeCount = accounts.filter((account) => account.status === "active").length;
  const signinAttention = accounts.filter((account) =>
    needsSignin(signinStatuses[account.id]?.state),
  ).length;

  async function refresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  function openQrDialog(account: Account) {
    setQrDialogError(null);
    setQrDialogAccount(account);
  }

  function runAction(account: Account, action: AccountAction) {
    if (action === "qr") openQrDialog(account);
    if (action === "logins") void listLoginSessions(account);
    if (action === "confirmations") void listConfirmations(account);
    if (action === "export") setExportAccount(account);
  }

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <PageHeader
        title="Codes"
        description={
          accounts.length === 0 ? undefined : (
            <>
              {accounts.length} account{accounts.length === 1 ? "" : "s"} · {activeCount} active
              {signinAttention > 0 ? (
                <>
                  {" · "}
                  <button
                    type="button"
                    onClick={onOpenSignins}
                    className="text-warning hover:underline"
                  >
                    {signinAttention} need{signinAttention === 1 ? "s" : ""} sign-in
                  </button>
                </>
              ) : null}
            </>
          )
        }
        actions={
          <>
            {accounts.length > 0 ? (
              <label className="relative hidden md:block">
                <span className="sr-only">Filter accounts</span>
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
                <Input
                  type="search"
                  placeholder="Filter accounts"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  className="w-56 pl-9 md:pl-9"
                />
              </label>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Refresh accounts"
              disabled={refreshing}
              onClick={() => void refresh()}
              className="hidden md:inline-flex"
            >
              <RefreshCwIcon className={cn(refreshing && "animate-spin")} />
            </Button>
            {role === "admin" ? (
              <Dialog open={importOpen} onOpenChange={setImportOpen}>
                <DialogTrigger asChild>
                  <Button type="button" aria-label="Import maFile" className="max-md:size-11 max-md:rounded-xl max-md:p-0">
                    <UploadIcon />
                    <span className="hidden md:inline">Import maFile</span>
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
          </>
        }
      />

      {accounts.length > 0 ? (
        <label className="relative md:hidden">
          <span className="sr-only">Filter accounts</span>
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-subtle" />
          <Input
            type="search"
            placeholder="Filter accounts"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="rounded-xl border-transparent pl-10"
          />
        </label>
      ) : null}

      {pageMessage ? (
        <Alert
          variant={pageMessage.kind === "error" ? "destructive" : "default"}
        >
          {pageMessage.kind === "error" ? (
            <AlertTriangleIcon />
          ) : (
            <CheckIcon />
          )}
          <AlertTitle>{pageMessage.title}</AlertTitle>
          {pageMessage.description ? (
            <AlertDescription>{pageMessage.description}</AlertDescription>
          ) : null}
        </Alert>
      ) : null}

      {accounts.length > 0 ? (
        <section
          aria-label="Accounts"
          className="flex flex-col gap-2.5 md:gap-0 md:overflow-hidden md:rounded-[14px] md:border md:bg-card"
        >
          {visibleAccounts.map((account, index) => {
            const disabled = account.status !== "active";
            const signinMissing = needsSignin(signinStatuses[account.id]?.state);
            return (
              <div
                key={account.id}
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-3.5 rounded-2xl bg-card py-3 pr-3 pl-4 md:flex-nowrap md:gap-4 md:rounded-none md:bg-transparent md:px-5 md:py-4",
                  index > 0 && "md:border-t",
                )}
              >
                <AccountAvatar account={account} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "truncate font-medium md:text-[15px]",
                        disabled && "text-muted-foreground",
                      )}
                    >
                      {account.accountName}
                    </span>
                    {disabled ? (
                      <span className="hidden shrink-0 rounded-full bg-secondary px-2 text-xs leading-[18px] text-muted-foreground md:inline">
                        Disabled
                      </span>
                    ) : null}
                  </div>
                  {signinMissing ? (
                    <button
                      type="button"
                      onClick={onOpenSignins}
                      className="block max-w-full truncate text-left text-xs text-warning hover:underline"
                    >
                      {disabled ? <span className="md:hidden">Disabled · </span> : null}
                      Not signed in
                      <span className="hidden md:inline"> to Steam · Sign in</span>
                    </button>
                  ) : (
                    <div className="truncate font-mono text-xs text-subtle">
                      {disabled ? <span className="font-sans md:hidden">Disabled · </span> : null}
                      {account.steamId || "Steam ID unknown"}
                    </div>
                  )}
                </div>
                <LiveCode accountId={account.id} accountName={account.accountName} />
                <div className="flex shrink-0 items-center gap-0.5 max-md:-mr-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="hidden text-muted-foreground md:inline-flex"
                    aria-label={`Approve QR login for ${account.accountName}`}
                    onClick={() => openQrDialog(account)}
                  >
                    <QrCodeIcon className="size-[17px]" />
                  </Button>
                  <AccountActionsMenu
                    account={account}
                    role={role}
                    isMobile={isMobile}
                    onAction={(action) => runAction(account, action)}
                  />
                </div>
              </div>
            );
          })}
          {visibleAccounts.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">
              No account matches "{filter.trim()}".
            </p>
          ) : null}
        </section>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
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
      )}

      {accounts.length > 0 ? (
        <p className="text-[13px] text-subtle">
          {isMobile ? "Tap" : "Click"} a code to copy it. Codes refresh every 30 seconds while
          shown, and every view is written to the audit log.
        </p>
      ) : null}

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

      <Dialog
        open={Boolean(loginSessionsPanel)}
        onOpenChange={(open) => {
          if (!open) setLoginSessionsPanel(null);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Login approvals</DialogTitle>
            <DialogDescription>
              {loginSessionsPanel?.accountName}
              {loginSessionsPanel?.sessions
                ? ` · ${loginSessionsPanel.sessions.length} pending`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {message && loginSessionsPanel ? (
            <Alert
              variant={message.kind === "error" ? "destructive" : "default"}
            >
              {message.kind === "error" ? <AlertTriangleIcon /> : <CheckIcon />}
              <AlertTitle>{message.title}</AlertTitle>
              {message.description ? (
                <AlertDescription>{message.description}</AlertDescription>
              ) : null}
            </Alert>
          ) : null}
          <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto">
            {!loginSessionsPanel?.sessions ? (
              <div
                aria-live="polite"
                className="flex items-center justify-center gap-2 rounded-lg border bg-muted/30 p-6 text-center text-sm text-muted-foreground"
              >
                <RefreshCwIcon className="size-4 animate-spin" />
                <span>Loading login approvals from Steam…</span>
              </div>
            ) : loginSessionsPanel.sessions.length === 0 ? (
              <div className="rounded-lg border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                No pending Steam login approvals for this account.
              </div>
            ) : (
              loginSessionsPanel.sessions.map((session) => {
                const acceptBusyKey = `${loginSessionsPanel.accountId}:${session.clientId}:accept`;
                const denyBusyKey = `${loginSessionsPanel.accountId}:${session.clientId}:deny`;

                return (
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
                        {loginBusy === acceptBusyKey ? "Accepting" : "Accept"}
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
                        {loginBusy === denyBusyKey ? "Denying" : "Deny"}
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!loginSessionsPanel || !loginSessionsPanel.sessions}
              onClick={() => {
                if (!loginSessionsPanel) return;
                void listLoginSessions({
                  id: loginSessionsPanel.accountId,
                  accountName: loginSessionsPanel.accountName,
                  steamId: null,
                  status: "active",
                });
              }}
            >
              <RefreshCwIcon />
              Refresh
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <Dialog
        open={Boolean(confirmationsPanel)}
        onOpenChange={(open) => {
          if (!open) setConfirmationsPanel(null);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Confirmations</DialogTitle>
            <DialogDescription>
              {confirmationsPanel?.accountName}
              {confirmationsPanel?.confirmations
                ? ` · ${confirmationsPanel.confirmations.length} pending`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {message && confirmationsPanel ? (
            <Alert
              variant={message.kind === "error" ? "destructive" : "default"}
            >
              {message.kind === "error" ? <AlertTriangleIcon /> : <CheckIcon />}
              <AlertTitle>{message.title}</AlertTitle>
              {message.description ? (
                <AlertDescription>{message.description}</AlertDescription>
              ) : null}
            </Alert>
          ) : null}
          <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto">
            {!confirmationsPanel?.confirmations ? (
              <div
                aria-live="polite"
                className="flex items-center justify-center gap-2 rounded-lg border bg-muted/30 p-6 text-center text-sm text-muted-foreground"
              >
                <RefreshCwIcon className="size-4 animate-spin" />
                <span>Loading confirmations from Steam…</span>
              </div>
            ) : confirmationsPanel.confirmations.length === 0 ? (
              <div className="rounded-lg border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                No pending Steam mobile confirmations for this account.
              </div>
            ) : (
              confirmationsPanel.confirmations.map((confirmation) => {
                const acceptBusyKey = `${confirmation.id}:accept`;
                const denyBusyKey = `${confirmation.id}:deny`;

                return (
                  <div
                    key={confirmation.id}
                    className="flex flex-col gap-3 rounded-lg border bg-background p-4 md:flex-row md:items-start md:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">
                          {confirmation.type_name ||
                            `type ${confirmation.type}`}
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
                        {confirmationBusy === acceptBusyKey
                          ? "Accepting"
                          : "Accept"}
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
                        {confirmationBusy === denyBusyKey ? "Denying" : "Deny"}
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!confirmationsPanel || !confirmationsPanel.confirmations}
              onClick={() => {
                if (!confirmationsPanel) return;
                void listConfirmations({
                  id: confirmationsPanel.accountId,
                  accountName: confirmationsPanel.accountName,
                  steamId: null,
                  status: "active",
                });
              }}
            >
              <RefreshCwIcon />
              Refresh
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          <div
            role="alert"
            className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-sm text-destructive"
          >
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
            <p>
              The file holds every secret in plaintext, including the shared
              secret and revocation code. Anyone who gets it controls the Steam
              account. This download is logged.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
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
