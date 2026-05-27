"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  PlusCircle,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCog,
  Wallet,
} from "lucide-react";

import { Admin, type AdminUser } from "@/lib/api";
import { notifyUserRefresh, useCurrentUser } from "@/hooks/use-current-user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/lib/i18n";
import { cn, formatCredits } from "@/lib/utils";

type RoleOpt = "admin" | "user";
type PrioOpt = "high" | "normal" | "low";

const PRIO_KEY: Record<PrioOpt, string> = {
  high: "admin.users.priority.high",
  normal: "admin.users.priority.normal",
  low: "admin.users.priority.low",
};
const PRIO_COLOR: Record<PrioOpt, string> = {
  high: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  normal: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  low: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

export default function AdminUsersPage() {
  const me = useCurrentUser();
  const { toast } = useToast();
  const t = useT();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [resettingPwdFor, setResettingPwdFor] = useState<AdminUser | null>(null);
  const [toppingUpFor, setToppingUpFor] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const data = await Admin.listUsers();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Skip le fetch tant qu'on ne sait pas si on est admin OU si on
    // sait qu'on ne l'est pas (sinon le 403 affiche un "Not Found"
    // rouge au-dessus du message "réservée").
    if (me === null || me.role !== "admin") return;
    void refresh();
  }, [me]);

  // Redirect-ish : si on n'est pas admin, on affiche un message au lieu
  // de leak l'UI. L'API renvoie déjà 403 — c'est juste pour le rendu.
  if (me && me.role !== "admin") {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
        {t("admin.page.forbidden")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ShieldCheck className="h-6 w-6 text-amber-300" />
            {t("admin.page.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("admin.page.subtitle")}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <PlusCircle className="h-4 w-4" />
          {t("admin.users.new")}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-background/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">{t("admin.col.username")}</th>
              <th className="px-3 py-2">{t("admin.col.role")}</th>
              <th className="px-3 py-2">{t("admin.col.priority")}</th>
              <th className="px-3 py-2 text-right">{t("admin.col.templates")}</th>
              <th className="px-3 py-2 text-right">{t("admin.col.credits")}</th>
              <th className="px-3 py-2 text-center">{t("admin.col.status")}</th>
              <th className="px-3 py-2 text-right">{t("admin.col.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading && users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </td>
              </tr>
            )}
            {users.map((u) => {
              const isMe = me?.id === u.id;
              return (
                <tr key={u.id} className="hover:bg-accent/20">
                  <td className="px-3 py-2 font-medium">
                    {u.username}
                    {isMe && (
                      <span className="ml-2 rounded bg-amber-500/15 px-1 py-0.5 text-[10px] text-amber-300">
                        {t("admin.page.you_badge")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded px-2 py-0.5 text-[11px]",
                        u.role === "admin"
                          ? "bg-amber-500/15 text-amber-300"
                          : "bg-zinc-500/15 text-zinc-300",
                      )}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded border px-2 py-0.5 text-[11px]",
                        PRIO_COLOR[u.priority],
                      )}
                    >
                      {t(PRIO_KEY[u.priority])}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {u.template_count}
                    {u.max_templates != null && (
                      <span className="text-muted-foreground">
                        {" "}/ {u.max_templates}
                      </span>
                    )}
                    {u.max_templates == null && (
                      <span className="text-muted-foreground"> / ∞</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {u.role === "admin" ? (
                      <span className="text-muted-foreground">∞</span>
                    ) : (
                      formatCredits(u.render_credits)
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {u.is_active ? (
                      <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-300">
                        {t("admin.status.active")}
                      </span>
                    ) : (
                      <span className="rounded bg-zinc-500/15 px-2 py-0.5 text-[11px] text-zinc-400">
                        {t("admin.status.inactive")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t("admin.action.edit")}
                        onClick={() => setEditing(u)}
                      >
                        <UserCog className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t("admin.action.reset_pw")}
                        onClick={() => setResettingPwdFor(u)}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t("admin.action.add_credits")}
                        onClick={() => setToppingUpFor(u)}
                        disabled={u.role === "admin"}
                      >
                        <Wallet className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t("admin.action.delete")}
                        onClick={() => setDeleting(u)}
                        disabled={isMe}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          void refresh();
          toast({ title: t("admin.toast.created") });
        }}
      />

      {editing && (
        <EditUserDialog
          user={editing}
          onOpenChange={(v) => !v && setEditing(null)}
          onSaved={() => {
            void refresh();
            // Si l'admin a édité son propre compte (crédits, role,
            // priorité, etc.) → notifier les hooks pour que la sidebar
            // affiche les nouvelles valeurs sans rechargement.
            if (editing.id === me?.id) notifyUserRefresh();
            setEditing(null);
            toast({ title: t("admin.toast.updated") });
          }}
        />
      )}

      {resettingPwdFor && (
        <ResetPasswordDialog
          user={resettingPwdFor}
          onOpenChange={(v) => !v && setResettingPwdFor(null)}
          onDone={() => {
            setResettingPwdFor(null);
            toast({ title: t("admin.toast.pw_reset") });
          }}
        />
      )}

      {toppingUpFor && (
        <TopUpDialog
          user={toppingUpFor}
          onOpenChange={(v) => !v && setToppingUpFor(null)}
          onDone={() => {
            void refresh();
            // Idem : top-up sur soi-même → sidebar refresh.
            if (toppingUpFor.id === me?.id) notifyUserRefresh();
            setToppingUpFor(null);
            toast({ title: t("admin.toast.credits_added") });
          }}
        />
      )}

      {deleting && (
        <DeleteUserDialog
          user={deleting}
          onOpenChange={(v) => !v && setDeleting(null)}
          onDeleted={() => {
            void refresh();
            setDeleting(null);
            toast({ title: t("admin.toast.deleted") });
          }}
        />
      )}
    </div>
  );
}

// ---- Sub-dialogs ------------------------------------------------------

/** Génère un mot de passe aléatoire de 14 caractères mélangeant
 *  lettres haut/bas, chiffres et symboles courants. Évite les chars
 *  ambigus ($, `, ', etc.) qui peuvent foirer un copy-paste en
 *  terminal / fichier .env. */
function generateStrongPassword(): string {
  const chars =
    "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#%*+=?";
  const out = new Uint8Array(14);
  crypto.getRandomValues(out);
  return Array.from(out, (b) => chars[b % chars.length]).join("");
}

function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const t = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<RoleOpt>("user");
  const [priority, setPriority] = useState<PrioOpt>("normal");
  const [maxTemplates, setMaxTemplates] = useState<number>(5);
  const [credits, setCredits] = useState<number>(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Quand non-null, on remplace le formulaire par la vue "success"
  // qui affiche les credentials + bouton "Copier les identifiants".
  const [successCreds, setSuccessCreds] = useState<
    { username: string; password: string } | null
  >(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setUsername("");
      setPassword("");
      setRole("user");
      setPriority("normal");
      setMaxTemplates(5);
      setCredits(50);
      setError(null);
      setSuccessCreds(null);
      setCopied(false);
    }
  }, [open]);

  async function submit() {
    if (!username || !password) return;
    setBusy(true);
    setError(null);
    try {
      await Admin.createUser({
        username,
        password,
        role,
        priority,
        max_templates: role === "admin" ? null : maxTemplates,
        render_credits: role === "admin" ? 1_000_000_000 : credits,
      });
      // Rafraîchit la liste côté parent (l'user apparaît) mais on
      // GARDE la modale ouverte pour afficher l'écran de
      // confirmation avec les identifiants à copier.
      onCreated();
      setSuccessCreds({ username, password });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function copyCredentials() {
    if (!successCreds) return;
    const text =
      `Grumtor.com\n` +
      `Username : ${successCreds.username}\n` +
      `Password : ${successCreds.password}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: t("admin.success.copied_toast") });
      // Reset l'icône check après 2s pour ne pas piéger l'admin si
      // il copie de nouveau.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: t("admin.success.copy_failed.title"),
        description: t("admin.success.copy_failed.desc"),
      });
    }
  }

  // ----- Success view : credentials + Copy -----
  if (successCreds) {
    const credsText =
      `Grumtor.com\n` +
      `Username : ${successCreds.username}\n` +
      `Password : ${successCreds.password}`;
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.success.title")}</DialogTitle>
            <DialogDescription>
              {t("admin.success.desc")}
            </DialogDescription>
          </DialogHeader>
          <pre className="select-all whitespace-pre-wrap rounded-md border border-border bg-background/40 p-3 font-mono text-xs">
            {credsText}
          </pre>
          <DialogFooter className="sm:justify-between">
            <Button variant="outline" onClick={copyCredentials}>
              {copied ? (
                <Check className="h-4 w-4 text-emerald-400" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied ? t("common.copied") : t("admin.success.copy")}
            </Button>
            <Button onClick={() => onOpenChange(false)}>{t("common.done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ----- Form view -----
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("admin.create.title")}</DialogTitle>
          <DialogDescription>
            {t("admin.create.desc")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field label={t("admin.col.username")}>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("admin.create.username.placeholder")}
              autoFocus
            />
          </Field>
          <Field label={t("admin.create.password.label")}>
            <div className="flex gap-2">
              <Input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("admin.create.password.placeholder")}
                className="flex-1 font-mono"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPassword(generateStrongPassword())}
                title={t("admin.create.password.generate_title")}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {t("admin.users.password.generate")}
              </Button>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("admin.col.role")}>
              <Select value={role} onValueChange={(v) => setRole(v as RoleOpt)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">user</SelectItem>
                  <SelectItem value="admin">admin</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("admin.create.priority.label")}>
              <Select value={priority} onValueChange={(v) => setPriority(v as PrioOpt)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">{t("admin.users.priority.high")}</SelectItem>
                  <SelectItem value="normal">{t("admin.users.priority.normal")}</SelectItem>
                  <SelectItem value="low">{t("admin.users.priority.low")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          {role === "user" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("admin.create.max_templates")}>
                <Input
                  type="number"
                  min={0}
                  value={maxTemplates}
                  onChange={(e) => setMaxTemplates(Number(e.target.value))}
                />
              </Field>
              <Field label={t("admin.create.credits_initial")}>
                <Input
                  type="number"
                  min={0}
                  value={credits}
                  onChange={(e) => setCredits(Number(e.target.value))}
                />
              </Field>
            </div>
          )}
          {role === "admin" && (
            <p className="text-[11px] text-muted-foreground">
              {t("admin.create.admin_note")}
            </p>
          )}
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={busy || !username || !password}
          >
            {busy ? "…" : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  user,
  onOpenChange,
  onSaved,
}: {
  user: AdminUser;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [username, setUsername] = useState(user.username);
  const [role, setRole] = useState<RoleOpt>(user.role);
  const [priority, setPriority] = useState<PrioOpt>(user.priority);
  const [maxTemplates, setMaxTemplates] = useState<number>(
    user.max_templates ?? 0,
  );
  const [unlimitedTemplates, setUnlimitedTemplates] = useState<boolean>(
    user.max_templates == null,
  );
  const [credits, setCredits] = useState<number>(user.render_credits);
  const [isActive, setIsActive] = useState<boolean>(user.is_active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await Admin.updateUser(user.id, {
        username,
        role,
        priority,
        max_templates: unlimitedTemplates ? null : maxTemplates,
        render_credits: credits,
        is_active: isActive,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("admin.edit.title", { name: user.username })}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field label={t("admin.col.username")}>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("admin.col.role")}>
              <Select value={role} onValueChange={(v) => setRole(v as RoleOpt)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">user</SelectItem>
                  <SelectItem value="admin">admin</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("admin.create.priority.label")}>
              <Select value={priority} onValueChange={(v) => setPriority(v as PrioOpt)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">{t("admin.users.priority.high")}</SelectItem>
                  <SelectItem value="normal">{t("admin.users.priority.normal")}</SelectItem>
                  <SelectItem value="low">{t("admin.users.priority.low")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={
                <span className="flex items-center gap-2">
                  {t("admin.create.max_templates")}
                  <label className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={unlimitedTemplates}
                      onChange={(e) => setUnlimitedTemplates(e.target.checked)}
                    />
                    {t("admin.users.unlimited")}
                  </label>
                </span>
              }
            >
              <Input
                type="number"
                min={0}
                disabled={unlimitedTemplates}
                value={maxTemplates}
                onChange={(e) => setMaxTemplates(Number(e.target.value))}
              />
            </Field>
            <Field label={t("admin.edit.credits_exact")}>
              <Input
                type="number"
                min={0}
                value={credits}
                onChange={(e) => setCredits(Number(e.target.value))}
              />
            </Field>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            {t("admin.edit.active_label")}
          </label>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || !username}>
            {busy ? "…" : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  user,
  onOpenChange,
  onDone,
}: {
  user: AdminUser;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const t = useT();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!pw || pw.length < 4) {
      setError(t("admin.reset.min_error"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await Admin.resetPassword(user.id, pw);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("admin.reset.title", { name: user.username })}</DialogTitle>
          <DialogDescription>
            {t("admin.reset.desc")}
          </DialogDescription>
        </DialogHeader>
        <Field label={t("admin.reset.new_label")}>
          <Input
            type="text"
            autoFocus
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder={t("admin.create.password.placeholder")}
          />
        </Field>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || !pw}>
            {busy ? "…" : t("admin.reset.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TopUpDialog({
  user,
  onOpenChange,
  onDone,
}: {
  user: AdminUser;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const t = useT();
  const [amount, setAmount] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (amount <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await Admin.topUpCredits(user.id, amount);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("admin.topup.title", { name: user.username })}</DialogTitle>
          <DialogDescription>
            {t("admin.topup.desc.prefix")} <strong>{formatCredits(user.render_credits)}</strong>{t("admin.topup.desc.suffix")} <strong>{t("admin.topup.desc.additive")}</strong> {t("admin.topup.desc.end")}
          </DialogDescription>
        </DialogHeader>
        <Field label={t("admin.topup.amount_label")}>
          <Input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            autoFocus
          />
        </Field>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || amount <= 0}>
            {busy ? "…" : t("admin.topup.submit", { n: amount })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteUserDialog({
  user,
  onOpenChange,
  onDeleted,
}: {
  user: AdminUser;
  onOpenChange: (v: boolean) => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = confirm === user.username;

  async function submit() {
    if (!canDelete) return;
    setBusy(true);
    setError(null);
    try {
      await Admin.deleteUser(user.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("admin.delete.title", { name: user.username })}</DialogTitle>
          <DialogDescription>
            {t("admin.delete.desc.prefix")} <strong>{t("admin.delete.desc.irreversible")}</strong>{t("admin.delete.desc.body", { tpl: user.template_count, jobs: user.job_count })}{" "}
            <code className="rounded bg-muted px-1 font-mono text-xs">
              {user.username}
            </code>{" "}
            {t("admin.delete.desc.confirm")}
          </DialogDescription>
        </DialogHeader>
        <Input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={user.username}
          autoFocus
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={busy || !canDelete}
          >
            {busy ? "…" : t("admin.delete.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
