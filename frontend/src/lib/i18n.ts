/**
 * Lightweight i18n system. No external lib — just dictionaries and a
 * `t()` lookup. Reads the current user's `language` field and falls
 * back to French if absent.
 *
 * Usage in components:
 *   const t = useT();
 *   <h1>{t("templates.title")}</h1>
 *
 * Adding a new string :
 *   1. Add the key + value in BOTH `fr` and `en` dictionaries below.
 *   2. Replace the hardcoded string in the component with `t("the.key")`.
 *
 * Interpolation : pass values as the second arg.
 *   t("credits.missing", { count: 3 })   →  "3 credits missing"
 *   string template uses {count} placeholders.
 */

import { useCurrentUser } from "@/hooks/use-current-user";
import type { AppLang } from "@/lib/api";

type Dict = Record<string, string>;

const fr: Dict = {
  // ----- common -----
  "common.loading": "Chargement…",
  "common.save": "Enregistrer",
  "common.saving": "Enregistrement…",
  "common.saved": "Enregistré",
  "common.cancel": "Annuler",
  "common.delete": "Supprimer",
  "common.confirm": "Confirmer",
  "common.close": "Fermer",
  "common.create": "Créer",
  "common.edit": "Éditer",
  "common.duplicate": "Dupliquer",
  "common.rename": "Renommer",
  "common.back": "Retour",
  "common.next": "Suivant",
  "common.previous": "Précédent",
  "common.search": "Rechercher",
  "common.copy": "Copier",
  "common.copied": "Copié !",
  "common.done": "Terminé",
  "common.yes": "Oui",
  "common.no": "Non",
  "common.error": "Erreur",
  "common.upload": "Uploader",
  "common.download": "Télécharger",
  "common.required": "obligatoire",
  "common.optional": "optionnel",
  "common.actions": "Actions",
  "common.name": "Nom",
  "common.status": "Statut",
  "common.created": "Créé",
  "common.updated": "Mis à jour",
  "common.size": "Taille",
  "common.duration": "Durée",

  // ----- navigation / sidebar -----
  "nav.dashboard": "Dashboard",
  "nav.templates": "Templates",
  "nav.render": "Lancer un render",
  "nav.photos": "Photos",
  "nav.jobs": "Mes rendus",
  "nav.assets": "Fonts",
  "nav.admin": "Admin",
  "nav.logout": "Déconnexion",
  "nav.language": "Langue",
  "nav.credits": "crédits",
  "nav.templates_count": "templates",

  // ----- login -----
  "login.title": "Connexion",
  "login.subtitle": "Connecte-toi pour accéder à ton studio",
  "login.username": "Nom d'utilisateur",
  "login.password": "Mot de passe",
  "login.submit": "Se connecter",
  "login.submitting": "Connexion…",
  "login.error.invalid": "Identifiants invalides",
  "login.error.rate_limit": "Trop de tentatives. Réessaie plus tard.",

  // ----- templates page -----
  "templates.title": "Templates",
  "templates.subtitle": "Crée et édite tes templates de montage",
  "templates.new": "Nouveau template",
  "templates.empty": "Aucun template — clique sur « Nouveau template » pour commencer.",
  "templates.limit_reached": "Limite de templates atteinte",
  "templates.limit_detail": "Tu as atteint ta limite de {max} templates. Supprime un template existant pour en créer un nouveau.",
  "templates.delete_confirm": "Supprimer ce template ? Cette action est irréversible.",
  "templates.created_at": "Créé le {date}",
  "templates.preview": "Aperçu",

  // ----- render new / batch -----
  "render.title": "Lancer un render",
  "render.subtitle": "Choisis tes templates et tes vidéos sources",
  "render.batch_name": "Nom du batch",
  "render.batch_name_placeholder": "Mon batch du 24 mai",
  "render.add_template": "Ajouter un template",
  "render.upload_videos": "Vidéos sources",
  "render.upload_drop": "Glisse tes vidéos ici ou clique pour choisir",
  "render.generations": "Nombre de variations par template",
  "render.naming": "Nommage des fichiers",
  "render.naming.default": "Défaut (template_1.mp4)",
  "render.naming.iphone": "iPhone (IMG_0001.mp4)",
  "render.launch": "Lancer le batch",
  "render.launching": "Lancement…",
  "render.cost": "Coût : {n} crédits",
  "render.insufficient_credits": "{missing} crédits manquants",
  "render.no_credits_left": "Plus aucun crédit. Demande à l'admin d'en ajouter.",
  "render.spoof.title": "Spoofer les métadonnées (iPhone)",
  "render.spoof.description": "Fait passer la vidéo pour une capture iPhone authentique",
  "render.spoof.country": "Pays",
  "render.spoof.model": "Modèle iPhone",

  // ----- jobs / render history -----
  "jobs.title": "Mes rendus",
  "jobs.subtitle": "Auto-refresh adaptatif : 3s tant qu'un job tourne, 15s sinon.",
  "jobs.empty": "Aucun job — lance un batch depuis « Lancer un render ».",
  "jobs.zip": "ZIP",
  "jobs.details": "Détails →",
  "jobs.files": "Fichiers de sortie",
  "jobs.no_files": "Aucun fichier rendu.",
  "jobs.progress": "Progression : {pct}%",
  "jobs.error": "Erreur",
  "jobs.zip_global": "ZIP global",
  "jobs.status.queued": "En attente",
  "jobs.status.running": "En cours",
  "jobs.status.done": "Terminé",
  "jobs.status.failed": "Échec",
  "jobs.files_count": "{n} fichier",
  "jobs.files_count_plural": "{n} fichiers",

  // ----- admin / users -----
  "admin.users.title": "Utilisateurs",
  "admin.users.subtitle": "Crée, gère et top-up les comptes de ton équipe",
  "admin.users.new": "Nouvel utilisateur",
  "admin.users.username": "Nom d'utilisateur",
  "admin.users.password": "Mot de passe initial",
  "admin.users.password.generate": "Générer",
  "admin.users.role": "Rôle",
  "admin.users.role.admin": "Admin",
  "admin.users.role.user": "User",
  "admin.users.priority": "Priorité de rendu",
  "admin.users.priority.high": "Haute",
  "admin.users.priority.normal": "Normale",
  "admin.users.priority.low": "Basse",
  "admin.users.max_templates": "Limite templates",
  "admin.users.credits": "Crédits",
  "admin.users.credits.add": "Ajouter des crédits",
  "admin.users.credits.amount": "Montant",
  "admin.users.reset_password": "Réinitialiser le mot de passe",
  "admin.users.delete": "Supprimer",
  "admin.users.delete_confirm": "Supprimer {name} ? Tous ses templates et rendus seront aussi supprimés.",
  "admin.users.success.title": "Compte créé ✓",
  "admin.users.success.description": "Communique ces identifiants à la personne en main propre — ils ne seront plus jamais affichés ailleurs.",
  "admin.users.success.copy": "Copier les identifiants",
  "admin.users.col.username": "Utilisateur",
  "admin.users.col.role": "Rôle",
  "admin.users.col.templates": "Templates",
  "admin.users.col.credits": "Crédits",
  "admin.users.col.status": "Statut",
  "admin.users.col.actions": "Actions",
  "admin.users.active": "Actif",
  "admin.users.inactive": "Inactif",
  "admin.users.unlimited": "illimité",

  // ----- editor (clips / layers / timeline) -----
  "editor.tab.clips": "Clips",
  "editor.tab.layers": "Layers",
  "editor.tab.audio": "Audio",
  "editor.tab.text": "Texte",
  "editor.tab.style": "Style",
  "editor.tab.position": "Position",
  "editor.add_clip": "Ajouter un clip",
  "editor.add_text": "Ajouter un texte",
  "editor.add_image": "Ajouter une image",
  "editor.add_gif": "Ajouter un GIF",
  "editor.add_emoji": "Ajouter un emoji",
  "editor.add_extra_track": "Ajouter une piste",
  "editor.undo": "Annuler",
  "editor.redo": "Refaire",
  "editor.play": "Lecture",
  "editor.pause": "Pause",
  "editor.cut": "Couper",
  "editor.text.placeholder": "Tape ton texte (et insère des emojis avec 😀)",
  "editor.text.font": "Police",
  "editor.text.size": "Taille du texte",
  "editor.text.color": "Couleur du texte",
  "editor.text.opacity": "Opacité",
  "editor.text.stroke": "Contour (outline)",
  "editor.text.highlight": "Surlignage",
  "editor.text.align": "Alignement",
  "editor.text.bold": "Gras",
  "editor.text.italic": "Italique",
  "editor.text.line_height": "Hauteur de ligne",
  "editor.text.letter_spacing": "Espacement des lettres",
  "editor.text.max_width": "Largeur max",
  "editor.text.placement": "Zone de placement",
  "editor.text.placement.fixed": "Fixe",
  "editor.text.placement.random": "Zones aléatoires",
  "editor.text.placement.random_desc": "Le texte tombe aléatoirement dans une des zones à chaque vidéo",
  "editor.text.pool": "Textes — pool de variations",
  "editor.text.pool.hint": "Chaque vidéo pioche aléatoirement une variation de ce pool. Sépare avec --- sur sa ligne. Une seule variation = même texte partout.",
  "editor.text.pool.variation": "{n} variation",
  "editor.text.pool.variations": "{n} variations",
  "editor.clip.trim_in": "Début (s)",
  "editor.clip.trim_out": "Fin (s)",
  "editor.clip.duration": "Durée (s)",
  "editor.clip.audio_enabled": "Son activé",
  "editor.clip.audio_volume": "Volume",
  "editor.clip.filter": "Filtre",
  "editor.clip.filter.none": "Aucun",
  "editor.clip.filter.bw": "Noir & blanc",
  "editor.clip.freeze": "Image figée (freeze)",
  "editor.clip.freeze.position": "Position du freeze (s)",
  "editor.clip.freeze.duration": "Durée du freeze (s)",
  "editor.template.name": "Nom du template",
  "editor.template.language": "Langue cible (FR / US)",

  // ----- toasts / errors -----
  "toast.saved": "Modifications enregistrées",
  "toast.save_failed": "Échec de l'enregistrement",
  "toast.deleted": "Supprimé",
  "toast.copy_failed": "Impossible de copier",
  "toast.upload.failed": "Échec de l'upload",
  "toast.render.launched": "Render lancé",
  "toast.render.failed": "Échec du lancement",
  "toast.credits.insufficient": "Crédits insuffisants",
  "toast.password.copied": "Identifiants copiés",
  "toast.template.limit": "Limite de templates atteinte",
};

const en: Dict = {
  // ----- common -----
  "common.loading": "Loading…",
  "common.save": "Save",
  "common.saving": "Saving…",
  "common.saved": "Saved",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.confirm": "Confirm",
  "common.close": "Close",
  "common.create": "Create",
  "common.edit": "Edit",
  "common.duplicate": "Duplicate",
  "common.rename": "Rename",
  "common.back": "Back",
  "common.next": "Next",
  "common.previous": "Previous",
  "common.search": "Search",
  "common.copy": "Copy",
  "common.copied": "Copied!",
  "common.done": "Done",
  "common.yes": "Yes",
  "common.no": "No",
  "common.error": "Error",
  "common.upload": "Upload",
  "common.download": "Download",
  "common.required": "required",
  "common.optional": "optional",
  "common.actions": "Actions",
  "common.name": "Name",
  "common.status": "Status",
  "common.created": "Created",
  "common.updated": "Updated",
  "common.size": "Size",
  "common.duration": "Duration",

  // ----- navigation / sidebar -----
  "nav.dashboard": "Dashboard",
  "nav.templates": "Templates",
  "nav.render": "New render",
  "nav.photos": "Photos",
  "nav.jobs": "My renders",
  "nav.assets": "Fonts",
  "nav.admin": "Admin",
  "nav.logout": "Log out",
  "nav.language": "Language",
  "nav.credits": "credits",
  "nav.templates_count": "templates",

  // ----- login -----
  "login.title": "Sign in",
  "login.subtitle": "Sign in to access your studio",
  "login.username": "Username",
  "login.password": "Password",
  "login.submit": "Sign in",
  "login.submitting": "Signing in…",
  "login.error.invalid": "Invalid credentials",
  "login.error.rate_limit": "Too many attempts. Try again later.",

  // ----- templates page -----
  "templates.title": "Templates",
  "templates.subtitle": "Create and edit your montage templates",
  "templates.new": "New template",
  "templates.empty": "No templates — click \"New template\" to get started.",
  "templates.limit_reached": "Template limit reached",
  "templates.limit_detail": "You've reached your limit of {max} templates. Delete an existing one to create a new one.",
  "templates.delete_confirm": "Delete this template? This cannot be undone.",
  "templates.created_at": "Created {date}",
  "templates.preview": "Preview",

  // ----- render new / batch -----
  "render.title": "New render",
  "render.subtitle": "Pick your templates and source videos",
  "render.batch_name": "Batch name",
  "render.batch_name_placeholder": "My May 24 batch",
  "render.add_template": "Add a template",
  "render.upload_videos": "Source videos",
  "render.upload_drop": "Drop your videos here or click to pick",
  "render.generations": "Variations per template",
  "render.naming": "File naming",
  "render.naming.default": "Default (template_1.mp4)",
  "render.naming.iphone": "iPhone (IMG_0001.mp4)",
  "render.launch": "Launch batch",
  "render.launching": "Launching…",
  "render.cost": "Cost: {n} credits",
  "render.insufficient_credits": "{missing} credits missing",
  "render.no_credits_left": "No credits left. Ask the admin to add some.",
  "render.spoof.title": "Spoof metadata (iPhone)",
  "render.spoof.description": "Makes the video look like an authentic iPhone capture",
  "render.spoof.country": "Country",
  "render.spoof.model": "iPhone model",

  // ----- jobs / render history -----
  "jobs.title": "My renders",
  "jobs.subtitle": "Adaptive auto-refresh: 3s while a job is running, 15s otherwise.",
  "jobs.empty": "No jobs yet — launch a batch from \"New render\".",
  "jobs.zip": "ZIP",
  "jobs.details": "Details →",
  "jobs.files": "Output files",
  "jobs.no_files": "No rendered files.",
  "jobs.progress": "Progress: {pct}%",
  "jobs.error": "Error",
  "jobs.zip_global": "Global ZIP",
  "jobs.status.queued": "Queued",
  "jobs.status.running": "Running",
  "jobs.status.done": "Done",
  "jobs.status.failed": "Failed",
  "jobs.files_count": "{n} file",
  "jobs.files_count_plural": "{n} files",

  // ----- admin / users -----
  "admin.users.title": "Users",
  "admin.users.subtitle": "Create, manage and top-up your team's accounts",
  "admin.users.new": "New user",
  "admin.users.username": "Username",
  "admin.users.password": "Initial password",
  "admin.users.password.generate": "Generate",
  "admin.users.role": "Role",
  "admin.users.role.admin": "Admin",
  "admin.users.role.user": "User",
  "admin.users.priority": "Render priority",
  "admin.users.priority.high": "High",
  "admin.users.priority.normal": "Normal",
  "admin.users.priority.low": "Low",
  "admin.users.max_templates": "Template limit",
  "admin.users.credits": "Credits",
  "admin.users.credits.add": "Add credits",
  "admin.users.credits.amount": "Amount",
  "admin.users.reset_password": "Reset password",
  "admin.users.delete": "Delete",
  "admin.users.delete_confirm": "Delete {name}? All their templates and renders will be deleted too.",
  "admin.users.success.title": "Account created ✓",
  "admin.users.success.description": "Hand these credentials to the user personally — they won't be shown again anywhere.",
  "admin.users.success.copy": "Copy credentials",
  "admin.users.col.username": "User",
  "admin.users.col.role": "Role",
  "admin.users.col.templates": "Templates",
  "admin.users.col.credits": "Credits",
  "admin.users.col.status": "Status",
  "admin.users.col.actions": "Actions",
  "admin.users.active": "Active",
  "admin.users.inactive": "Inactive",
  "admin.users.unlimited": "unlimited",

  // ----- editor -----
  "editor.tab.clips": "Clips",
  "editor.tab.layers": "Layers",
  "editor.tab.audio": "Audio",
  "editor.tab.text": "Text",
  "editor.tab.style": "Style",
  "editor.tab.position": "Position",
  "editor.add_clip": "Add a clip",
  "editor.add_text": "Add text",
  "editor.add_image": "Add an image",
  "editor.add_gif": "Add a GIF",
  "editor.add_emoji": "Add an emoji",
  "editor.add_extra_track": "Add a track",
  "editor.undo": "Undo",
  "editor.redo": "Redo",
  "editor.play": "Play",
  "editor.pause": "Pause",
  "editor.cut": "Cut",
  "editor.text.placeholder": "Type your text (insert emojis with 😀)",
  "editor.text.font": "Font",
  "editor.text.size": "Text size",
  "editor.text.color": "Text color",
  "editor.text.opacity": "Opacity",
  "editor.text.stroke": "Outline",
  "editor.text.highlight": "Highlight",
  "editor.text.align": "Alignment",
  "editor.text.bold": "Bold",
  "editor.text.italic": "Italic",
  "editor.text.line_height": "Line height",
  "editor.text.letter_spacing": "Letter spacing",
  "editor.text.max_width": "Max width",
  "editor.text.placement": "Placement zone",
  "editor.text.placement.fixed": "Fixed",
  "editor.text.placement.random": "Random zones",
  "editor.text.placement.random_desc": "Text drops randomly into one of the zones for each video",
  "editor.text.pool": "Texts — variation pool",
  "editor.text.pool.hint": "Each video picks one variation at random from this pool. Separate with --- on its own line. A single variation = same text everywhere.",
  "editor.text.pool.variation": "{n} variation",
  "editor.text.pool.variations": "{n} variations",
  "editor.clip.trim_in": "In (s)",
  "editor.clip.trim_out": "Out (s)",
  "editor.clip.duration": "Duration (s)",
  "editor.clip.audio_enabled": "Audio on",
  "editor.clip.audio_volume": "Volume",
  "editor.clip.filter": "Filter",
  "editor.clip.filter.none": "None",
  "editor.clip.filter.bw": "Black & white",
  "editor.clip.freeze": "Freeze frame",
  "editor.clip.freeze.position": "Freeze position (s)",
  "editor.clip.freeze.duration": "Freeze duration (s)",
  "editor.template.name": "Template name",
  "editor.template.language": "Target language (FR / US)",

  // ----- toasts / errors -----
  "toast.saved": "Changes saved",
  "toast.save_failed": "Save failed",
  "toast.deleted": "Deleted",
  "toast.copy_failed": "Could not copy",
  "toast.upload.failed": "Upload failed",
  "toast.render.launched": "Render launched",
  "toast.render.failed": "Failed to launch",
  "toast.credits.insufficient": "Insufficient credits",
  "toast.password.copied": "Credentials copied",
  "toast.template.limit": "Template limit reached",
};

const DICTS: Record<AppLang, Dict> = { fr, en };

/**
 * Interpolate {placeholders} in a translation string.
 * Example : interp("Hello {name}", { name: "Enzo" }) → "Hello Enzo"
 */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? `{${k}}` : String(v);
  });
}

/**
 * Lookup a translation key for a given language. Falls back to French
 * if the key is missing in the requested language, then to the key
 * itself (so missing translations are visible in dev).
 */
export function translate(
  lang: AppLang,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const value = DICTS[lang]?.[key] ?? DICTS.fr[key] ?? key;
  return interpolate(value, vars);
}

/**
 * React hook : returns a `t(key, vars?)` function bound to the current
 * user's language. Re-renders the component when the user switches
 * language. If no user is loaded yet, falls back to French (best UX
 * for a French-first app).
 */
export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const user = useCurrentUser();
  const lang: AppLang = (user?.language as AppLang) ?? "fr";
  return (key, vars) => translate(lang, key, vars);
}

/** Returns the current language, or "fr" if not loaded yet. */
export function useLang(): AppLang {
  const user = useCurrentUser();
  return (user?.language as AppLang) ?? "fr";
}
