"use client";

import { useEffect, useState } from "react";
import {
  KeyRound,
  Loader2,
  PlusCircle,
  ShieldCheck,
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
import { cn } from "@/lib/utils";

type RoleOpt = "admin" | "user";
type PrioOpt = "high" | "normal" | "low";

const PRIO_LABEL: Record<PrioOpt, string> = {
  high: "Haute",
  normal: "Normale",
  low: "Basse",
};
const PRIO_COLOR: Record<PrioOpt, string> = {
  high: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  normal: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  low: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

export default function AdminUsersPage() {
  const me = useCurrentUser();
  const { toast } = useToast();
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
        Cette page est réservée à l&apos;administrateur.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ShieldCheck className="h-6 w-6 text-amber-300" />
            Administration des comptes
          </h1>
          <p className="text-sm text-muted-foreground">
            Crée et gère les comptes utilisateurs. Tu attribues les crédits
            et les limites manuellement.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <PlusCircle className="h-4 w-4" />
          Nouvel utilisateur
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
              <th className="px-3 py-2">Username</th>
              <th className="px-3 py-2">Rôle</th>
              <th className="px-3 py-2">Priorité</th>
              <th className="px-3 py-2 text-right">Templates</th>
              <th className="px-3 py-2 text-right">Crédits</th>
              <th className="px-3 py-2 text-center">Statut</th>
              <th className="px-3 py-2 text-right">Actions</th>
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
                        toi
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
                      {PRIO_LABEL[u.priority]}
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
                      u.render_credits.toLocaleString("fr-FR")
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {u.is_active ? (
                      <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-300">
                        actif
                      </span>
                    ) : (
                      <span className="rounded bg-zinc-500/15 px-2 py-0.5 text-[11px] text-zinc-400">
                        désactivé
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Éditer"
                        onClick={() => setEditing(u)}
                      >
                        <UserCog className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Reset password"
                        onClick={() => setResettingPwdFor(u)}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Ajouter des crédits"
                        onClick={() => setToppingUpFor(u)}
                        disabled={u.role === "admin"}
                      >
                        <Wallet className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Supprimer"
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
          toast({ title: "Utilisateur créé" });
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
            toast({ title: "Utilisateur mis à jour" });
          }}
        />
      )}

      {resettingPwdFor && (
        <ResetPasswordDialog
          user={resettingPwdFor}
          onOpenChange={(v) => !v && setResettingPwdFor(null)}
          onDone={() => {
            setResettingPwdFor(null);
            toast({ title: "Password réinitialisé" });
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
            toast({ title: "Crédits ajoutés" });
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
            toast({ title: "Utilisateur supprimé" });
          }}
        />
      )}
    </div>
  );
}

// ---- Sub-dialogs ------------------------------------------------------

function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<RoleOpt>("user");
  const [priority, setPriority] = useState<PrioOpt>("normal");
  const [maxTemplates, setMaxTemplates] = useState<number>(5);
  const [credits, setCredits] = useState<number>(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUsername("");
      setPassword("");
      setRole("user");
      setPriority("normal");
      setMaxTemplates(5);
      setCredits(50);
      setError(null);
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
      onCreated();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvel utilisateur</DialogTitle>
          <DialogDescription>
            Crée le compte. Le user pourra se connecter immédiatement avec
            ce username + password.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field label="Username">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ex: claire"
              autoFocus
            />
          </Field>
          <Field label="Password initial">
            <Input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="min. 4 chars"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rôle">
              <Select value={role} onValueChange={(v) => setRole(v as RoleOpt)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">user</SelectItem>
                  <SelectItem value="admin">admin</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Priorité queue">
              <Select value={priority} onValueChange={(v) => setPriority(v as PrioOpt)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">Haute</SelectItem>
                  <SelectItem value="normal">Normale</SelectItem>
                  <SelectItem value="low">Basse</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          {role === "user" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Max templates">
                <Input
                  type="number"
                  min={0}
                  value={maxTemplates}
                  onChange={(e) => setMaxTemplates(Number(e.target.value))}
                />
              </Field>
              <Field label="Crédits initiaux">
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
              Les admins ont des templates et crédits illimités par défaut.
            </p>
          )}
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            onClick={submit}
            disabled={busy || !username || !password}
          >
            {busy ? "…" : "Créer"}
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
          <DialogTitle>Éditer {user.username}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field label="Username">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rôle">
              <Select value={role} onValueChange={(v) => setRole(v as RoleOpt)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">user</SelectItem>
                  <SelectItem value="admin">admin</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Priorité queue">
              <Select value={priority} onValueChange={(v) => setPriority(v as PrioOpt)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">Haute</SelectItem>
                  <SelectItem value="normal">Normale</SelectItem>
                  <SelectItem value="low">Basse</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={
                <span className="flex items-center gap-2">
                  Max templates
                  <label className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={unlimitedTemplates}
                      onChange={(e) => setUnlimitedTemplates(e.target.checked)}
                    />
                    illimité
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
            <Field label="Crédits (valeur exacte)">
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
            Compte actif (peut se connecter)
          </label>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={busy || !username}>
            {busy ? "…" : "Enregistrer"}
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
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!pw || pw.length < 4) {
      setError("Min 4 caractères.");
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
          <DialogTitle>Reset password de {user.username}</DialogTitle>
          <DialogDescription>
            Communique le nouveau mot de passe en main propre — il n&apos;y a
            pas d&apos;envoi par email.
          </DialogDescription>
        </DialogHeader>
        <Field label="Nouveau password">
          <Input
            type="text"
            autoFocus
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="min. 4 chars"
          />
        </Field>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={busy || !pw}>
            {busy ? "…" : "Réinitialiser"}
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
          <DialogTitle>Ajouter des crédits à {user.username}</DialogTitle>
          <DialogDescription>
            Crédits actuels : <strong>{user.render_credits.toLocaleString("fr-FR")}</strong>.
            Le montant est <strong>additif</strong> (pour SET la valeur exacte
            utilise l&apos;édition).
          </DialogDescription>
        </DialogHeader>
        <Field label="Montant à ajouter">
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
            Annuler
          </Button>
          <Button onClick={submit} disabled={busy || amount <= 0}>
            {busy ? "…" : `+${amount} crédits`}
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
          <DialogTitle>Supprimer {user.username} ?</DialogTitle>
          <DialogDescription>
            Action <strong>irréversible</strong>. Tous ses templates
            ({user.template_count}), ses jobs ({user.job_count}) et ses
            fichiers seront définitivement effacés. Tape{" "}
            <code className="rounded bg-muted px-1 font-mono text-xs">
              {user.username}
            </code>{" "}
            pour confirmer.
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
            Annuler
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={busy || !canDelete}
          >
            {busy ? "…" : "Supprimer définitivement"}
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
