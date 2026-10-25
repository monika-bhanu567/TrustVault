import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  HardDrive,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import "./App.css";
import { TrustVaultLogo } from "./components/TrustVaultLogo";

type User = {
  id: string;
  email: string;
  role?: string;
};

type ApiDocument = {
  id: string;
  isOwner: boolean;
  original_name: string;
  mime_type: string;
  size_bytes: number | string;
  created_at: string;
  category: string;
  ownerEmail: string;
};

type DocumentItem = {
  id: string;
  isOwner: boolean;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
  category: string;
  ownerEmail: string;
};

type DocumentGrant = {
  id: string;
  userId: string;
  email: string;
  canRead: boolean;
  canEdit: boolean;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  active: boolean;
};


type SharedDocument = {
  grantId: string;
  documentId: string;
  documentName: string;
  ownerEmail: string;
  canRead: boolean;
  canEdit: boolean;
  sharedAt: string;
  expiresAt: string | null;
};

type AuditEvent = {
  id: string;
  eventType: string;
  entityType: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};

type AuditVerification = {
  valid: boolean;
  checkedEvents: number;
  invalidEventId?: string;
  reason?: string;
};

type AdminOverview = {
  metrics: { activeUsers: number; activeDocuments: number; activeGrants: number; deniedLast24Hours: number };
  events: AuditEvent[];
};

const navigation = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "My Documents", icon: FolderOpen },
  { label: "Shared with me", icon: Users },
  { label: "Shared by me", icon: Share2 },
  { label: "Audit Trail", icon: Activity },
];

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const hasJsonBody = options.body != null && !isFormData;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
  `${typeof body.error === "string" ? body.error : "Request failed"} (HTTP ${response.status})`,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getFileKind(mime: string) {
  if (mime === "application/pdf") {
    return { label: "PDF document", icon: FileText, tone: "pdf" };
  }
  if (mime.startsWith("image/")) {
    return { label: "Image", icon: FileImage, tone: "image" };
  }
  return { label: "Text document", icon: FileText, tone: "text" };
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [documents, setDocuments] = useState<DocumentItem[]>([]); 
  const [sharedDocuments, setSharedDocuments] = useState<SharedDocument[]>([]);
  const [loadingShared, setLoadingShared] = useState(false);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [auditVerification, setAuditVerification] =
  useState<AuditVerification | null>(null);
  const [loadingVerification, setLoadingVerification] = useState(false);
  const [sharingDocumentId, setSharingDocumentId] = useState("");
  const [shareEmail, setShareEmail] = useState("");
  const [sharePermission, setSharePermission] = useState<"read" | "write">("read");
  const [grants, setGrants] = useState<DocumentGrant[]>([]);
  const [loadingGrants, setLoadingGrants] = useState(false);
  const [activeNav, setActiveNav] = useState("Overview");
  const [search, setSearch] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(false);

  const showMessage = (message: string, isError = false) => {
    setNotice(message);
    setNoticeError(isError);
  };

  const loadDocuments = useCallback(async () => {
    setLoadingDocuments(true);
    try {
      const result = await api<{ documents: ApiDocument[] }>("/documents");
      setDocuments(
        result.documents.map((doc) => ({
          id: doc.id,
          isOwner: doc.isOwner,
          name: doc.original_name,
          mime: doc.mime_type,
          size: Number(doc.size_bytes),
          createdAt: doc.created_at,
          category: doc.category,
          ownerEmail: doc.ownerEmail,
        })),
      );
    } finally {
      setLoadingDocuments(false);
    }
  }, []);

  const checkSession = useCallback(async () => {
    try {
      await api<{ authenticated: boolean; userId: string }>("/session/check");
      const result = await api<{ user: User }>("/auth/me");
      setUser(result.user);
    } catch {
      setUser(null);
      setDocuments([]);
    }
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  useEffect(() => {
    if (!user) return;
    void loadDocuments().catch((error: unknown) => {
      showMessage(
        error instanceof Error ? error.message : "Unable to load documents.",
        true,
      );
    });
  }, [user, loadDocuments]);

  const loadAdminOverview = useCallback(async () => {
    setLoadingAdmin(true);
    try { setAdminOverview(await api<AdminOverview>("/admin/overview")); }
    catch (error) { showMessage(error instanceof Error ? error.message : "Unable to load administration data.", true); }
    finally { setLoadingAdmin(false); }
  }, []);

  useEffect(() => {
   if (!user || activeNav !== "Shared with me") return;
   void loadSharedDocuments();
}, [user, activeNav]);

  useEffect(() => {
    if (user?.role === "ADMIN" && activeNav === "Admin Dashboard") void loadAdminOverview();
  }, [user, activeNav, loadAdminOverview]);
  
  useEffect(() => {
  if (!user || activeNav !== "Audit Trail") return;

  void loadAuditEvents();
  void verifyAuditIntegrity();
}, [user, activeNav]);

  const filteredDocuments = useMemo(
    () =>
      documents.filter((doc) =>
        doc.name.toLowerCase().includes(search.toLowerCase().trim()) &&
        (!ownerFilter || doc.ownerEmail.toLowerCase().includes(ownerFilter.toLowerCase())) &&
        (!categoryFilter || doc.category === categoryFilter),
      ),
    [documents, search, ownerFilter, categoryFilter],
  );

  const totalBytes = documents.reduce((total, doc) => total + doc.size, 0);
  const storageLimit = 100 * 1024 * 1024;
  const storagePercent = Math.min(100, (totalBytes / storageLimit) * 100);

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    showMessage("");

    try {
      if (authMode === "register") {
        await api("/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
      }

      await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      const result = await api<{ user: User }>("/auth/me");
      setUser(result.user);
      setPassword("");
      showMessage("You're signed in. Welcome to your private vault.");
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : "Authentication failed.",
        true,
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      // Clear the local interface even if the request fails.
    } finally {
      setUser(null);
      setDocuments([]);
      setPassword("");
      setBusy(false);
      showMessage("");
    }
  }

  async function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    const allowedTypes = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "text/plain",
    ];

    if (file.size > 10 * 1024 * 1024) {
      showMessage("Choose a file smaller than 10 MB.", true);
      input.value = "";
      return;
    }

    if (!allowedTypes.includes(file.type)) {
      showMessage("Choose a PDF, PNG, JPEG, or plain text file.", true);
      input.value = "";
      return;
    }

    setBusy(true);
    showMessage("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      await api("/documents", {
        method: "POST",
        body: formData,
      });

      await loadDocuments();
      setShowUpload(false);
      showMessage(`${file.name} was uploaded successfully.`);
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : "Upload failed.",
        true,
      );
    } finally {
      setBusy(false);
      input.value = "";
    }
  }

  async function handleReplacementSelection(
    event: ChangeEvent<HTMLInputElement>,
    documentId: string,
    documentName: string,
  ) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    const allowedTypes = ["application/pdf", "image/png", "image/jpeg", "text/plain"];
    if (file.size > 10 * 1024 * 1024 || !allowedTypes.includes(file.type)) {
      showMessage("Choose a PDF, PNG, JPEG, or plain text file smaller than 10 MB.", true);
      input.value = "";
      return;
    }

    setBusy(true);
    showMessage("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      await api(`/documents/${encodeURIComponent(documentId)}/content`, {
        method: "POST",
        body: formData,
      });
      input.value = "";
      await Promise.all([loadDocuments(), loadSharedDocuments()]);
      showMessage(`${documentName} was replaced and re-encrypted successfully.`);
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : "Unable to replace document content.",
        true,
      );
    } finally {
      setBusy(false);
    }
  }
  async function loadAuditEvents() {
  setLoadingAudit(true);

  try {
    const result = await api<{ events: AuditEvent[] }>("/audit?limit=50");
    setAuditEvents(result.events);
  } catch (error) {
    showMessage(
      error instanceof Error
        ? error.message
        : "Unable to load audit events.",
      true
    );
  } finally {
    setLoadingAudit(false);
  }
}

  async function verifyAuditIntegrity() {
  setLoadingVerification(true);

  try {
    const result = await api<AuditVerification>("/audit/verify");
    setAuditVerification(result);
  } catch (error) {
    showMessage(
      error instanceof Error
        ? error.message
        : "Unable to verify audit integrity.",
      true
    );
  } finally {
    setLoadingVerification(false);
  }
}
  async function loadSharedDocuments() {
  setLoadingShared(true);

  try {
    const result = await api<{ documents: SharedDocument[] }>(
      "/shared-with-me"
    );
    setSharedDocuments(result.documents);
  } catch (error) {
    showMessage(
      error instanceof Error
        ? error.message
        : "Unable to load shared documents.",
      true
    );
  } finally {
    setLoadingShared(false);
  }
}

    async function loadGrants(documentId: string) {
    setLoadingGrants(true);

    try {
      const result = await api<{ grants: DocumentGrant[] }>(
        `/documents/${encodeURIComponent(documentId)}/grants`
      );

      setGrants(result.grants);
    } catch (error) {
      showMessage(
        error instanceof Error
          ? error.message
          : "Unable to load access permissions.",
        true
      );
    } finally {
      setLoadingGrants(false);
    }
  }

    async function handleShare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!sharingDocumentId || !shareEmail.trim()) {
      showMessage("Choose a document and enter a recipient email.", true);
      return;
    }

    setBusy(true);
    showMessage("");

    try {
      await api(`/documents/${encodeURIComponent(sharingDocumentId)}/grants`, {
        method: "POST",
        body: JSON.stringify({
          email: shareEmail.trim(),
          canRead: true,
          canEdit: sharePermission === "write",
        }),
      });

      setShareEmail("");
      await loadGrants(sharingDocumentId);
      showMessage("Document access shared successfully.");
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : "Unable to share document.",
        true
      );
    } finally {
      setBusy(false);
    }
  }
  
    async function handleRevoke(grantId: string) {
    if (!sharingDocumentId) return;
    const grant = grants.find((item) => item.id === grantId);

    if (
      !window.confirm(
        `Revoke ${grant?.email ?? "this recipient"}'s access immediately?`,
      )
    ) {
      return;
    }

    setBusy(true);
    showMessage("");

    try {
      await api(
        `/documents/${encodeURIComponent(sharingDocumentId)}/grants/${encodeURIComponent(grantId)}`,
        { method: "DELETE" }
      );

      // Reflect the security change immediately. The server remains authoritative;
      // refresh afterwards to reconcile the complete grant history.
      setGrants((current) =>
        current.map((item) =>
          item.id === grantId
            ? { ...item, active: false, revokedAt: new Date().toISOString() }
            : item,
        ),
      );
      void loadGrants(sharingDocumentId);
      showMessage("Document access revoked successfully.");
    } catch (error) {
      showMessage(
        error instanceof Error
          ? error.message
          : "Unable to revoke document access.",
        true
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload(doc: DocumentItem) {
    try {
      const response = await fetch(
        `${API_BASE_URL}/documents/${encodeURIComponent(doc.id)}/download`,
        { credentials: "include" },
      );

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Download failed (${response.status})`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = doc.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showMessage(`Download started for ${doc.name}.`);
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : "Download failed.",
        true,
      );
    }
  }

  async function handleDelete(doc: DocumentItem) {
    if (!window.confirm(`Permanently remove ${doc.name} from your vault?`)) return;

    setBusy(true);
    showMessage("");
    try {
      await api(`/documents/${encodeURIComponent(doc.id)}`, { method: "DELETE" });
      await loadDocuments();
      showMessage(`${doc.name} was removed from your vault.`);
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : "Unable to remove document.",
        true,
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleCategoryChange(doc: DocumentItem, category: string) {
    if (category === doc.category) return;
    try {
      await api(`/documents/${encodeURIComponent(doc.id)}/category`, { method: "PATCH", body: JSON.stringify({ category }) });
      setDocuments((current) => current.map((item) => item.id === doc.id ? { ...item, category } : item));
      showMessage(`${doc.name} moved to ${category}.`);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "Unable to update category.", true);
    }
  }

  if (!user) {
    return (
      <main className="landing-page">
        <header className="landing-nav">
          <a className="landing-brand" href="#top"><TrustVaultLogo /></a>
          <nav aria-label="Main navigation">
            <a href="#features">Features</a>
            <a href="#security">Security</a>
            <a href="#how-it-works">How It Works</a>
            <a href="#about">About</a>
          </nav>
          <div className="landing-nav-actions">
            <button className="landing-text-button" onClick={() => { setAuthMode("login"); document.getElementById("get-started")?.scrollIntoView({ behavior: "smooth" }); }}>Sign In</button>
            <button className="landing-small-cta" onClick={() => { setAuthMode("register"); document.getElementById("get-started")?.scrollIntoView({ behavior: "smooth" }); }}>Get Started <ArrowUpRight size={15} /></button>
          </div>
        </header>

        <section className="landing-hero" id="top">
          <div className="hero-copy">
            <span className="landing-eyebrow"><ShieldCheck size={15} /> EXPLAINABLE ZERO-TRUST DOCUMENT VAULT</span>
            <h1>Your Documents.<br /><em>Your Control.</em><br />Your Trust.</h1>
            <p>Encrypted storage, explicit access decisions, and a transparent audit trail—so every document stays with the people you chose.</p>
            <div className="hero-actions">
              <button className="landing-primary" onClick={() => { setAuthMode("register"); document.getElementById("get-started")?.scrollIntoView({ behavior: "smooth" }); }}>Get Started <ArrowUpRight size={17} /></button>
              <a className="landing-secondary" href="#security">Explore Security <Shield size={17} /></a>
            </div>
            <div className="hero-proof"><span><Check size={15} /> AES-256-GCM encryption</span><span><Check size={15} /> Backend-enforced permissions</span></div>
          </div>
          <div className="vault-visual" aria-label="Illustration of a protected document vault">
            <div className="visual-orbit orbit-one" /><div className="visual-orbit orbit-two" />
            <div className="vault-window">
              <div className="vault-window-bar"><span /><span /><span /><strong>TRUSTVAULT / SECURE SPACE</strong></div>
              <div className="vault-file-row"><span className="vault-file-icon"><FileText size={21} /></span><div><strong>offer_letter_15060.pdf</strong><small>Encrypted · Integrity verified</small></div><span className="vault-lock"><LockKeyhole size={16} /></span></div>
              <div className="vault-grant"><span className="vault-avatar">M</span><div><strong>Access decision</strong><small>Read &amp; write · Explicit grant</small></div><CheckCircle2 size={19} /></div>
              <div className="vault-audit"><Activity size={16} /><span>Audit event recorded</span><small>now</small></div>
            </div>
            <div className="visual-badge"><ShieldCheck size={18} /> Protected by design</div>
          </div>
        </section>

        <section className="trust-strip" aria-label="TrustVault security principles">
          <span><LockKeyhole size={18} /> Encrypted at rest</span><span><Shield size={18} /> Zero-trust decisions</span><span><Activity size={18} /> Verifiable audit trail</span>
        </section>

        <section className="landing-section security-section" id="security">
          <div className="section-lead"><span className="landing-eyebrow">BUILT FOR THE MOMENT AFTER “WHO ACCESSED THIS?”</span><h2>Security you can explain.</h2><p>TrustVault keeps security decisions close to the document, where they belong—not hidden in a folder setting.</p></div>
          <div className="security-principles">
            <article><LockKeyhole size={23} /><h3>Encryption at rest</h3><p>Files are encrypted with AES-256-GCM and checked for integrity before they are released.</p></article>
            <article><ShieldCheck size={23} /><h3>Zero-trust authorization</h3><p>Every download and replacement request is decided by the backend using current ownership and grants.</p></article>
            <article><Share2 size={23} /><h3>Controlled sharing</h3><p>Owners grant named people read or write access, then revoke it when access should end.</p></article>
            <article><Activity size={23} /><h3>Audit evidence</h3><p>Security-relevant activity is recorded in an append-only HMAC-linked audit chain.</p></article>
          </div>
        </section>

        <section className="landing-section feature-section" id="features">
          <div className="section-lead"><span className="landing-eyebrow">THE VAULT, NOT JUST THE FILE LIST</span><h2>Made for careful document work.</h2></div>
          <div className="feature-grid">
            {[
              [FileText, "Secure document storage", "Validated uploads, encrypted file storage, and protected downloads."],
              [Share2, "Controlled sharing", "Share with registered people—document by document."],
              [ShieldCheck, "Read and write permissions", "Give access appropriate to the work, without widening it further."],
              [Activity, "Activity and audit trails", "Review important document and permission activity."],
              [CheckCircle2, "Integrity verification", "Authenticated encryption and content checks protect downloaded files."],
              [Folder, "Workspace management", "Keep owned and shared documents clear, separate, and actionable."],
            ].map(([Icon, title, description]) => {
              const FeatureIcon = Icon as typeof FileText;
              return <article className="feature-card" key={title as string}><span><FeatureIcon size={22} /></span><h3>{title as string}</h3><p>{description as string}</p></article>;
            })}
          </div>
        </section>

        <section className="landing-section how-section" id="how-it-works">
          <div className="section-lead"><span className="landing-eyebrow">A CLEARER WAY TO PROTECT WORK</span><h2>Security in three deliberate steps.</h2></div>
          <div className="how-steps"><article><span>01</span><h3>Upload and protect</h3><p>Submit a supported document. TrustVault validates, encrypts, and records its arrival.</p></article><article><span>02</span><h3>Decide access</h3><p>Grant a named person read or write permission. Nothing is inherited by accident.</p></article><article><span>03</span><h3>Review the evidence</h3><p>Inspect permission changes and security activity through the audit trail.</p></article></div>
        </section>

        <section className="landing-section philosophy-section" id="about">
          <div className="philosophy-graphic"><div className="graphic-user">You</div><div className="graphic-line line-one" /><div className="graphic-line line-two" /><div className="graphic-doc"><FileText size={25} /><span>Encrypted<br />document</span></div><div className="graphic-audit"><Activity size={19} /><span>Audited decision</span></div></div>
          <div className="philosophy-copy"><span className="landing-eyebrow">SECURITY-FIRST BY DEFAULT</span><h2>Every access decision should stand up to a question.</h2><p>TrustVault is designed around an uncomplicated rule: access is explicitly authorized by the server at the moment it is requested. Important actions leave traceable evidence without exposing document contents in the audit log.</p><a href="#get-started">Start with a protected workspace <ArrowUpRight size={16} /></a></div>
        </section>

        <section className="landing-cta"><div><span className="landing-eyebrow">YOUR PRIVATE DOCUMENT SPACE</span><h2>Take Control of Your Documents.</h2><p>Secure your files. Control access. Trust every decision.</p></div><button className="landing-cta-button" onClick={() => { setAuthMode("register"); document.getElementById("get-started")?.scrollIntoView({ behavior: "smooth" }); }}>Get Started <ArrowUpRight size={18} /></button></section>

        <section className="auth-card landing-auth" id="get-started">
          <div className="auth-brand">
            <TrustVaultLogo compact />
            <div>
              <div className="brand-name">
                TrustVault<span>.</span>
              </div>
              <div className="brand-caption">PRIVATE DOCUMENT SPACE</div>
            </div>
          </div>

          <div className="auth-intro">
            <span className="eyebrow">
              <span className="eyebrow-dot" />
              YOUR SPACE. YOUR CONTROL.
            </span>
            <h1>
              {authMode === "login"
                ? "Welcome back."
                : "Create your vault."}
            </h1>
            <p>
              {authMode === "login"
                ? "Your important documents, protected in one private place."
                : "Create your account and start building your private space."}
            </p>
          </div>

          {notice && (
            <div className={`auth-notice ${noticeError ? "is-error" : ""}`}>
              {noticeError ? <X size={17} /> : <CheckCircle2 size={17} />}
              <span>{notice}</span>
            </div>
          )}

          <form className="auth-form" onSubmit={handleAuth}>
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />

            <div className="password-label">
              <label htmlFor="password">Password</label>
              <span>12–72 characters</span>
            </div>
            <input
              id="password"
              type="password"
              autoComplete={
                authMode === "login" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              minLength={12}
              maxLength={72}
              required
            />

            <button className="primary-button auth-submit" disabled={busy}>
              {busy
                ? "Please wait…"
                : authMode === "login"
                  ? "Sign in to TrustVault"
                  : "Create secure account"}
              {!busy && <ArrowUpRight size={17} />}
            </button>
          </form>

          <div className="auth-switch">
            {authMode === "login"
              ? "New to TrustVault?"
              : "Already have an account?"}
            <button
              type="button"
              onClick={() => {
                setAuthMode(authMode === "login" ? "register" : "login");
                showMessage("");
              }}
            >
              {authMode === "login" ? "Create an account" : "Sign in"}
            </button>
          </div>

          <div className="auth-footer">
            <LockKeyhole size={15} />
            <span>Protected session · Private by design</span>
          </div>
        </section>

        <div className="auth-bottom-note">
          <Shield size={15} />
          A calmer, safer place for what matters.
        </div>
        <footer className="landing-footer">
          <div><div className="landing-brand"><TrustVaultLogo /></div><p>The explainable zero-trust document vault.</p></div>
          <div className="footer-links"><a href="#features">Features</a><a href="#security">Security</a><a href="#how-it-works">How It Works</a><button onClick={() => { setAuthMode("login"); document.getElementById("get-started")?.scrollIntoView({ behavior: "smooth" }); }}>Sign In</button></div>
          <small>© {new Date().getFullYear()} TrustVault · Privacy by design</small>
        </footer>
      </main>
    );
  }

  const visibleNavigation = user.role === "ADMIN"
    ? [...navigation, { label: "Admin Dashboard", icon: ShieldCheck }]
    : navigation;
  const selectedNavExists = visibleNavigation.some(
    (item) => item.label === activeNav,
  );
  const isOverview = activeNav === "Overview";
  const isMyDocuments = activeNav === "My Documents";

  return (
    <div className="app-shell">
      {mobileSidebar && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileSidebar(false)}
        />
      )}

      <aside className={`sidebar ${mobileSidebar ? "sidebar-open" : ""}`}>
        <button
          className="brand"
          onClick={() => {
            setActiveNav("Overview");
            setMobileSidebar(false);
          }}
        >
          <TrustVaultLogo compact />
          <span className="brand-name">
            TrustVault<span>.</span>
            <small>PRIVATE DOCUMENT SPACE</small>
          </span>
        </button>

        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace-switch">
          <span className="workspace-avatar">
            {(user.email[0] || "U").toUpperCase()}
          </span>
          <span className="workspace-copy">
            <strong>My workspace</strong>
            <small>Personal vault</small>
          </span>
          <ChevronDown size={15} />
        </div>

        <div className="nav-label">YOUR SPACE</div>
        <nav className="navigation">
          {visibleNavigation.map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={`nav-item ${activeNav === label ? "active" : ""}`}
              onClick={() => {
                setActiveNav(label);
                setMobileSidebar(false);
                showMessage("");
              }}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
              {label === "My Documents" && documents.length > 0 && (
                <span className="nav-count">{documents.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="storage-card">
            <div className="storage-heading">
              <span className="storage-icon">
                <HardDrive size={16} />
              </span>
              <span>Storage overview</span>
              <span className="storage-badge">LOCAL</span>
            </div>
            <div className="storage-number">
              {(totalBytes / (1024 * 1024)).toFixed(2)}
              <span> MB used</span>
            </div>
            <div className="storage-track">
              <span style={{ width: `${storagePercent}%` }} />
            </div>
            <div className="storage-foot">
              <span>Storage indicator</span>
              <span>{storagePercent.toFixed(1)}%</span>
            </div>
          </div>

          <button
            className={`nav-item settings-nav ${
              activeNav === "Settings" ? "active" : ""
            }`}
            onClick={() => setActiveNav("Settings")}
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>

          <div className="profile">
            <div className="profile-avatar">
              {(user.email[0] || "U").toUpperCase()}
            </div>
            <div className="profile-copy">
              <strong>{user.email}</strong>
              <small>{user.role || "Personal account"}</small>
            </div>
            <button
              className="icon-button logout-button"
              aria-label="Sign out"
              title="Sign out"
              onClick={handleLogout}
              disabled={busy}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu-button"
              aria-label="Open navigation"
              onClick={() => setMobileSidebar(true)}
            >
              <Menu size={20} />
            </button>
            <div className="breadcrumb">
              Workspace <span>/</span> <strong>{activeNav}</strong>
            </div>
          </div>

          <div className="topbar-actions">
            <div className="secure-pill">
              <span className="secure-dot" />
              <LockKeyhole size={14} />
              Secure workspace
            </div>
            <button
              className="icon-button notification-button"
              aria-label="Notifications"
              title="Notifications"
              onClick={() => showMessage("You're all caught up.")}
            >
              <Bell size={18} />
              <span className="notification-dot" />
            </button>
            <div className="top-avatar">
              {(user.email[0] || "U").toUpperCase()}
            </div>
          </div>
        </header>

        <div className="page-content">
          {notice && (
            <div className={`notice ${noticeError ? "is-error" : ""}`}>
              {noticeError ? <X size={17} /> : <CheckCircle2 size={17} />}
              <span>{notice}</span>
              <button
                className="icon-button"
                aria-label="Dismiss message"
                onClick={() => showMessage("")}
              >
                <X size={16} />
              </button>
            </div>
          )}

          {!selectedNavExists && activeNav !== "Settings" && (
            <section className="empty-section">
              <div className="empty-section-icon">
                <ShieldCheck size={30} />
              </div>
              <span className="eyebrow">TRUSTVAULT WORKSPACE</span>
              <h1>{activeNav}</h1>
              <p>
                This workspace section is ready for the next integration step.
              </p>
              <button
                className="primary-button"
                onClick={() => setActiveNav("Overview")}
              >
                Return to overview
              </button>
            </section>
          )}

          {activeNav === "Settings" && (
            <section className="empty-section">
              <div className="empty-section-icon">
                <Settings size={30} />
              </div>
              <span className="eyebrow">YOUR PREFERENCES</span>
              <h1>Settings</h1>
              <p>
                You're signed in as <strong>{user.email}</strong>.
              </p>
              <button
                className="secondary-button"
                onClick={handleLogout}
                disabled={busy}
              >
                <LogOut size={17} /> Sign out
              </button>
            </section>
          )}

          {(isOverview || isMyDocuments) && (
            <>
              <section className="welcome-row">
                <div>
                  <div className="eyebrow">
                    <span className="eyebrow-line" />
                    YOUR PRIVATE SPACE
                  </div>
                  <h1>
                    {isOverview ? "Your space, secured." : "My documents."}
                  </h1>
                  <p className="subtitle">
                    {isOverview
                      ? "A little more peace of mind starts here."
                      : "Every important file, organised in one private place."}
                  </p>
                </div>
                <button
                  className="primary-button upload-top-button"
                  onClick={() => setShowUpload(true)}
                >
                  <Plus size={18} /> Upload document
                </button>
              </section>

              {isOverview && (
                <section className="hero-banner">
                  <div className="hero-copy">
                    <span className="hero-kicker">
                      <Sparkles size={14} /> SECURITY, MADE SIMPLE
                    </span>
                    <h2>Your documents deserve a safer home.</h2>
                    <p>
                      TrustVault helps protect your files with encrypted
                      storage and access checks on the backend.
                    </p>
                    <button
                      className="hero-link"
                      onClick={() => setActiveNav("Audit Trail")}
                    >
                      Explore your security <ArrowUpRight size={16} />
                    </button>
                  </div>
                  <div className="hero-art" aria-hidden="true">
                    <div className="hero-orbit hero-orbit-one" />
                    <div className="hero-orbit hero-orbit-two" />
                    <div className="hero-glow" />
                    <div className="hero-shield">
                      <ShieldCheck size={56} strokeWidth={1.35} />
                    </div>
                    <div className="floating-lock">
                      <LockKeyhole size={18} />
                    </div>
                    <div className="floating-check">
                      <Check size={18} />
                    </div>
                  </div>
                  <div className="hero-bottom-label">
                    <span className="hero-bottom-dot" />
                    PRIVATE BY DESIGN
                  </div>
                </section>
              )}

              <section className="stats-grid">
                <article className="stat-card">
                  <div className="stat-top">
                    <span className="stat-icon icon-brown">
                      <Folder size={19} />
                    </span>
                    <span className="stat-label">YOUR DOCUMENTS</span>
                  </div>
                  <div className="stat-value">
                    {String(documents.length).padStart(2, "0")}
                    <span className="stat-unit"> files</span>
                  </div>
                  <div className="stat-bottom">
                    <span className="stat-caption">In your private vault</span>
                    <span className="stat-decoration">
                      <ArrowUpRight size={17} />
                    </span>
                  </div>
                </article>

                <article className="stat-card">
                  <div className="stat-top">
                    <span className="stat-icon icon-lavender">
                      <HardDrive size={19} />
                    </span>
                    <span className="stat-label">STORAGE USED</span>
                  </div>
                  <div className="stat-value">
                    {(totalBytes / (1024 * 1024)).toFixed(2)}
                    <span className="stat-unit"> MB</span>
                  </div>
                  <div className="stat-bottom">
                    <span className="stat-caption">
                      {storagePercent.toFixed(1)}% of display target
                    </span>
                    <span className="stat-decoration">
                      <ArrowUpRight size={17} />
                    </span>
                  </div>
                </article>

                <article className="stat-card">
                  <div className="stat-top">
                    <span className="stat-icon icon-silver">
                      <ShieldCheck size={19} />
                    </span>
                    <span className="stat-label">SECURITY STATUS</span>
                  </div>
                  <div className="stat-value security-value">
                    Protected<span className="status-indicator" />
                  </div>
                  <div className="stat-bottom">
                    <span className="stat-caption">
                      Authenticated workspace
                    </span>
                    <span className="stat-decoration">
                      <ArrowUpRight size={17} />
                    </span>
                  </div>
                </article>
              </section>

              <section className="documents-section">
                <div className="section-heading">
                  <div>
                    <div className="section-eyebrow">YOUR COLLECTION</div>
                    <h2>{isOverview ? "Recent documents" : "All documents"}</h2>
                    <p>
                      {isOverview
                        ? "Your files, right where you need them."
                        : `${documents.length} ${
                            documents.length === 1 ? "file" : "files"
                          } in your vault`}
                    </p>
                  </div>
                  <div className="document-actions">
                    <label className="search-box">
                      <Search size={17} />
                      <input
                        type="search"
                        placeholder="Search documents"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                      {search && (
                        <button
                          type="button"
                          aria-label="Clear search"
                          onClick={() => setSearch("")}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </label>
                    <input className="search-box compact-filter" aria-label="Filter by owner" placeholder="Owner email" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)} />
                    <select className="compact-filter" aria-label="Filter by category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                      <option value="">All categories</option>
                      {[...new Set(documents.map((doc) => doc.category))].sort().map((category) => <option key={category} value={category}>{category}</option>)}
                    </select>
                    <button
                      className="filter-button"
                      onClick={() => showMessage("Showing all supported files.")}
                      title="Filter documents"
                    >
                      <SlidersHorizontal size={17} />
                    </button>
                  </div>
                </div>

                {loadingDocuments ? (
                  <div className="loading-state">
                    <span className="loading-spinner" />
                    Loading your secure documents…
                  </div>
                ) : filteredDocuments.length === 0 ? (
                  <div className="empty-documents">
                    <div className="empty-document-icon">
                      {search ? <Search size={25} /> : <FolderOpen size={27} />}
                    </div>
                    <h3>{search ? "No matching documents" : "Your vault is ready"}</h3>
                    <p>
                      {search
                        ? "Try a different file name."
                        : "Upload your first file to start building your private collection."}
                    </p>
                    {!search && (
                      <button
                        className="primary-button"
                        onClick={() => setShowUpload(true)}
                      >
                        <Plus size={17} /> Upload your first file
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="document-table-wrap">
                    <table className="document-table">
                      <thead>
                        <tr>
                          <th>NAME</th>
                          <th>FILE TYPE</th>
                          <th>CATEGORY</th>
                          <th>SIZE</th>
                          <th>DATE ADDED</th>
                          <th aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {(isOverview
                          ? filteredDocuments.slice(0, 5)
                          : filteredDocuments
                        ).map((doc) => {
                          const kind = getFileKind(doc.mime);
                          const FileIcon = kind.icon;

                          return (
                            <tr key={doc.id}>
                              <td>
                                <div className="document-name-cell">
                                  <span className={`file-icon ${kind.tone}`}>
                                    <FileIcon size={19} strokeWidth={1.7} />
                                  </span>
                                  <div className="document-name-copy">
                                    <strong title={doc.name}>{doc.name}</strong>
                                    <span>Private document</span>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <span className="file-type-pill">{kind.label}</span>
                              </td>
                              <td className="table-muted">{doc.isOwner ? <select className="category-select" aria-label={`Category for ${doc.name}`} value={doc.category} onChange={(event) => void handleCategoryChange(doc, event.target.value)}><option>Uncategorized</option><option>Contracts</option><option>Finance</option><option>HR</option><option>Operations</option><option>Personal</option></select> : doc.category}</td>
                              <td className="table-muted">{formatSize(doc.size)}</td>
                              <td className="table-muted">
                                {formatDate(doc.createdAt)}
                              </td>
                              <td>
                                {doc.isOwner && (
                                  <label className="download-button replace-file-button" title={`Replace ${doc.name}`}>
                                    <ArrowUpRight size={17} />
                                    <input
                                      type="file"
                                      accept=".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain"
                                      disabled={busy}
                                      aria-label={`Replace ${doc.name}`}
                                      onChange={(event) => void handleReplacementSelection(event, doc.id, doc.name)}
                                    />
                                  </label>
                                )}
                                <button
                                  className="download-button"
                                  title={`Download ${doc.name}`}
                                  aria-label={`Download ${doc.name}`}
                                  onClick={() => void handleDownload(doc)}
                                >
                                  <ArrowDownToLine size={17} />
                                </button>
                                {doc.isOwner && (
                                  <button
                                    className="download-button"
                                    title={`Delete ${doc.name}`}
                                    aria-label={`Delete ${doc.name}`}
                                    disabled={busy}
                                    onClick={() => void handleDelete(doc)}
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {isOverview && filteredDocuments.length > 5 && (
                      <button
                        className="view-all-button"
                        onClick={() => setActiveNav("My Documents")}
                      >
                        View all {filteredDocuments.length} documents
                        <ArrowUpRight size={16} />
                      </button>
                    )}
                  </div>
                )}
              </section>

              <footer className="page-footer">
                <span>© {new Date().getFullYear()} TrustVault</span>
                <span className="footer-security">
                  <LockKeyhole size={13} /> Your private document space
                </span>
              </footer>
            </>
          )}

        
{activeNav === "Shared with me" && (
  <section className="share-panel">
    <div className="section-heading">
      <div>
        <span className="section-eyebrow">COLLABORATION</span>
        <h1>Shared with me</h1>
        <p>Documents other people have shared with you.</p>
      </div>
      <button
        className="secondary-button"
        type="button"
        onClick={() => void loadSharedDocuments()}
        disabled={loadingShared}
      >
        {loadingShared ? "Refreshing..." : "Refresh"}
      </button>
    </div>

    {loadingShared ? (
      <p>Loading shared documents...</p>
    ) : sharedDocuments.length === 0 ? (
      <div className="empty-section">
        <div className="empty-section-icon">
          <Users size={30} />
        </div>
        <h2>No shared documents yet</h2>
        <p>Documents shared with your account will appear here.</p>
      </div>
    ) : (
      <div className="document-grid">
        {sharedDocuments.map((doc) => (
          <article className="document-card" key={doc.grantId}>
            <div className="document-card-icon">
              <FileText size={24} />
            </div>
            <h2>{doc.documentName}</h2>
            <p>Shared by: {doc.ownerEmail}</p>
            <p>
              Permission: {doc.canEdit ? "Can edit" : "Read only"}
            </p>
            <p>
              Shared on: {new Date(doc.sharedAt).toLocaleDateString()}
            </p>
            {doc.expiresAt && (
              <p>
                Expires: {new Date(doc.expiresAt).toLocaleDateString()}
              </p>
            )}
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                void handleDownload({
                  id: doc.documentId,
                  isOwner: false,
                  name: doc.documentName,
                  mime: "",
                  size: 0,
                  createdAt: doc.sharedAt,
                  category: "Shared",
                  ownerEmail: doc.ownerEmail,
                })
              }
            >
              <ArrowDownToLine size={16} />
              Download
            </button>
            {doc.canEdit && (
              <label className="secondary-button replace-document-button">
                <ArrowUpRight size={16} />
                Replace contents
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain"
                  disabled={busy}
                  onChange={(event) =>
                    void handleReplacementSelection(event, doc.documentId, doc.documentName)
                  }
                />
              </label>
            )}
            {doc.canEdit && (
              <p className="replacement-note">Replacing content creates fresh encrypted storage; the file is not edited in-browser.</p>
            )}
          </article>
        ))}
      </div>
    )}
  </section>
)}


                    {activeNav === "Shared by me" && (
            <section className="share-panel">
              <div className="section-heading">
                <div>
                  <span className="section-eyebrow">COLLABORATION</span>
                  <h1>Shared by me</h1>
                  <p>Manage who can access your documents.</p>
                </div>
              </div>

              <div className="share-form-card">
                <h2>Share a document</h2>
                <form onSubmit={handleShare} className="share-form">
                  <label htmlFor="share-document">Choose document</label>
                  <select
                    id="share-document"
                    value={sharingDocumentId}
                    onChange={(event) => {
                      const id = event.target.value;
                      setSharingDocumentId(id);
                      setGrants([]);
                      if (id) void loadGrants(id);
                    }}
                    required
                  >
                    <option value="">Select a document</option>
                    {documents.filter((doc) => doc.isOwner).map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.name}
                      </option>
                    ))}
                  </select>

                  <label htmlFor="share-email">Recipient's registered email</label>
                  <input
                    id="share-email"
                    type="email"
                    placeholder="recipient@example.com"
                    value={shareEmail}
                    onChange={(event) => setShareEmail(event.target.value)}
                    required
                  />

<label htmlFor="share-permission">Access level</label>
<select
  id="share-permission"
  value={sharePermission}
  onChange={(event) =>
    setSharePermission(event.target.value as "read" | "write")
  }
>
  <option value="read">Read only — can view and download</option>
  <option value="write">Write access — can edit shared content</option>
</select>

<p className="share-help">
  {sharePermission === "write"
    ? "The recipient will be granted edit permission."
    : "The recipient can view and download but not edit."}
</p>

                  <button
                    className="primary-button"
                    type="submit"
                    disabled={busy || documents.length === 0}
                  >
                    <Share2 size={17} />
                    {busy ? "Please wait…" : "Share document"}
                  </button>
                </form>
              </div>

              <div className="share-form-card">
                <h2>Access permissions</h2>

                {!sharingDocumentId ? (
                  <p>Select a document above to view its permissions.</p>
                ) : loadingGrants ? (
                  <p>Loading permissions…</p>
                ) : grants.length === 0 ? (
                  <p>No access permissions found for this document.</p>
                ) : (
                  <div className="document-table-wrap">
                    <table className="document-table">
                      <thead>
                        <tr>
                          <th>RECIPIENT</th>
                          <th>PERMISSION</th>
                          <th>STATUS</th>
                          <th>ACTION</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grants.map((grant) => (
                          <tr key={grant.id}>
                            <td>{grant.email}</td>
                            <td>{grant.canEdit ? "Can edit" : "Read only"}</td>
                            <td>{grant.active ? "Active" : "Revoked"}</td>
                            <td>
                              {grant.active && (
                                <button
                                  className="secondary-button"
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void handleRevoke(grant.id)}
                                >
                                  Revoke
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          )}

          {activeNav === "Admin Dashboard" && user.role === "ADMIN" && (
            <section className="share-panel audit-panel">
              <div className="section-heading"><div><span className="section-eyebrow">ADMINISTRATION</span><h1>Security dashboard</h1><p>Global activity and current access posture.</p></div><button className="secondary-button" onClick={() => void loadAdminOverview()} disabled={loadingAdmin}>{loadingAdmin ? "Refreshing…" : "Refresh"}</button></div>
              {adminOverview && <>
                <div className="stats-grid admin-stats"><article className="stat-card"><span>ACTIVE USERS</span><strong>{adminOverview.metrics.activeUsers}</strong></article><article className="stat-card"><span>ACTIVE DOCUMENTS</span><strong>{adminOverview.metrics.activeDocuments}</strong></article><article className="stat-card"><span>ACTIVE GRANTS</span><strong>{adminOverview.metrics.activeGrants}</strong></article><article className="stat-card"><span>DENIED · 24H</span><strong>{adminOverview.metrics.deniedLast24Hours}</strong></article></div>
                <div className="audit-events"><div className="audit-events-heading"><div><h2>Recent security activity</h2><p>Newest events across the workspace.</p></div></div><div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>EVENT</th><th>ENTITY</th><th>DATE &amp; TIME</th><th>DETAILS</th></tr></thead><tbody>{adminOverview.events.map((event) => <tr key={event.id}><td><strong>{event.eventType.replace(/_/g, " ")}</strong></td><td>{event.entityType}</td><td>{new Date(event.createdAt).toLocaleString()}</td><td>{Object.entries(event.metadata).map(([key,value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`).join(" · ") || "—"}</td></tr>)}</tbody></table></div></div>
              </>}
            </section>
          )}

          {activeNav === "Audit Trail" && (
  <section className="share-panel audit-panel">
    <div className="section-heading">
      <div>
        <span className="section-eyebrow">SECURITY ACTIVITY</span>
        <h1>Audit Trail</h1>
        <p>Review recorded activity and verify the integrity of your audit log.</p>
      </div>
      <button
        className="secondary-button"
        type="button"
        disabled={loadingAudit || loadingVerification}
        onClick={() => {
          void loadAuditEvents();
          void verifyAuditIntegrity();
        }}
      >
        {loadingAudit || loadingVerification ? "Refreshing..." : "Refresh"}
      </button>
    </div>

    <div className="audit-verification">
      <div className="audit-verification-icon">
        <ShieldCheck size={24} />
      </div>
      <div>
        <h2>Audit Integrity</h2>
        {loadingVerification ? (
          <p>Verifying audit records...</p>
        ) : auditVerification ? (
          <>
            <p>
              {auditVerification.valid
                ? "Integrity check passed."
                : "Integrity check failed. The audit chain may have been altered."}
            </p>
            <span>
              {auditVerification.checkedEvents} events checked
            </span>
            {!auditVerification.valid && auditVerification.reason && (
              <p>Reason: {auditVerification.reason}</p>
            )}
          </>
        ) : (
          <p>Integrity verification has not completed yet.</p>
        )}
      </div>
      <button
        className="secondary-button"
        type="button"
        disabled={loadingVerification}
        onClick={() => void verifyAuditIntegrity()}
      >
        {loadingVerification ? "Checking..." : "Verify"}
      </button>
    </div>

    <div className="audit-events">
      <div className="audit-events-heading">
        <div>
          <h2>Recent Events</h2>
          <p>Showing up to 50 recorded events, newest first.</p>
        </div>
        <span>{auditEvents.length} events</span>
      </div>

      {loadingAudit ? (
        <p className="audit-empty">Loading audit events...</p>
      ) : auditEvents.length === 0 ? (
        <div className="audit-empty">
          <Activity size={28} />
          <h3>No audit events found</h3>
          <p>Recorded security activity will appear here.</p>
        </div>
      ) : (
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>EVENT</th>
                <th>ENTITY</th>
                <th>DATE &amp; TIME</th>
                <th>DETAILS</th>
              </tr>
            </thead>
            <tbody>
              {auditEvents.map((event) => (
                <tr key={event.id}>
                  <td>
                    <strong>{event.eventType.replace(/_/g, " ")}</strong>
                  </td>
                  <td>{event.entityType}</td>
                  <td>{new Date(event.createdAt).toLocaleString()}</td>
                  <td>
                    {Object.keys(event.metadata).length > 0
                      ? Object.entries(event.metadata)
                          .map(([key, value]) => {
                            const detail =
                              typeof value === "string"
                                ? value
                                : JSON.stringify(value);
                            return `${key}: ${detail}`;
                          })
                          .join(" · ")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  </section>
)}
        </div>
      </main>

      {showUpload && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) {
              setShowUpload(false);
            }
          }}
        >
          <section
            className="upload-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-title"
          >
            <div className="modal-header">
              <div>
                <span className="section-eyebrow">ADD TO YOUR VAULT</span>
                <h2 id="upload-title">Upload a document</h2>
                <p>Your next file, safely stored.</p>
              </div>
              <button
                className="icon-button"
                aria-label="Close upload dialog"
                onClick={() => !busy && setShowUpload(false)}
                disabled={busy}
              >
                <X size={19} />
              </button>
            </div>

            <label className="drop-zone">
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain"
                disabled={busy}
                onChange={handleFileSelection}
              />
              <span className="upload-cloud-icon">
                <Plus size={23} />
              </span>
              <strong>{busy ? "Uploading your file…" : "Choose a file to upload"}</strong>
              <span>PDF, PNG, JPEG or TXT</span>
              <span className="upload-limit">Maximum file size: 10 MB</span>
            </label>


            <div className="upload-security-note">
              <ShieldCheck size={17} />
              <span>
                The backend validates and encrypts uploaded files before
                storage.
              </span>
            </div>

            <button
              className="secondary-button modal-cancel"
              onClick={() => setShowUpload(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
