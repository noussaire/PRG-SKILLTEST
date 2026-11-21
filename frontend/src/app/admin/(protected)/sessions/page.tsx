"use client";

import { Suspense, useEffect, useState } from "react";
import { Plus, RefreshCw, KeyRound, Copy, Check, Lock, Unlock } from "lucide-react";
import { useLanguage } from "@/lib/language-context";
import { adminContent as c, adminDate } from "@/lib/admin-content";
import { PageHeader } from "@/components/admin/PageHeader";
import { Button } from "@/components/admin/Button";
import { StatCard } from "@/components/admin/StatCard";
import { FilterBar } from "@/components/admin/FilterBar";
import { FormField } from "@/components/admin/FormField";
import { EmptyState } from "@/components/admin/EmptyState";
import { Toast } from "@/components/admin/Toast";
import { AdminLoading, AdminError } from "@/components/admin/adaptive-ui";

interface AdminSessionItem {
  id: string;
  label: string;
  description: string | null;
  status: "DRAFT" | "SCHEDULED" | "OPEN" | "CLOSED" | "ARCHIVED";
  code: string;
  maxParticipants: number | null;
  participantsCount: number;
  completedCount: number;
  inProgressCount: number;
  createdAt: string;
}

interface SessionsResponse {
  sessions: AdminSessionItem[];
  stats: {
    totalSessions: number;
    openSessions: number;
    scheduledSessions: number;
    closedSessions: number;
    archivedSessions: number;
    totalParticipants: number;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  assessments: Array<{ id: string; title: string }>;
}

export default function AdminSessionsPage() {
  return (
    <Suspense>
      <SessionsList />
    </Suspense>
  );
}

function SessionsList() {
  const { lang } = useLanguage();
  const ar = lang === "ar";

  const [data, setData] = useState<SessionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [toast, setToast] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [page, setPage] = useState(1);

  // Create Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newMax, setNewMax] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newlyCreatedCode, setNewlyCreatedCode] = useState<string | null>(null);

  // Toggling status state
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);

    const query = new URLSearchParams({
      page: String(page),
      limit: "15",
      ...(search ? { search } : {}),
      ...(statusFilter !== "ALL" ? { status: statusFilter } : {}),
    });

    fetch(`/api/admin/sessions?${query}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        return res.json() as Promise<SessionsResponse>;
      })
      .then((val) => {
        if (active) setData(val);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [page, search, statusFilter, refresh]);

  async function toggleStatus(session: AdminSessionItem) {
    const nextStatus = session.status === "OPEN" ? "CLOSED" : "OPEN";
    setUpdatingId(session.id);
    try {
      const res = await fetch(`/api/admin/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error();
      setToast(
        nextStatus === "OPEN"
          ? ar
            ? "تم فتح الجلسة بنجاح."
            : "Session ouverte avec succès."
          : ar
          ? "تم إغلاق الجلسة."
          : "Session fermée avec succès."
      );
      setRefresh((v) => v + 1);
    } catch {
      setToast(
        ar ? "تعذر تغيير حالة الجلسة." : "Impossible de modifier la session."
      );
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleCreateSession(e: React.FormEvent) {
    e.preventDefault();
    if (!newLabel.trim() || creating) return;

    setCreating(true);
    setCreateError(null);

    try {
      const payload: {
        label: string;
        status: string;
        maxParticipants?: number;
      } = {
        label: newLabel.trim(),
        status: "OPEN",
      };

      if (newMax.trim() && Number(newMax) > 0) {
        payload.maxParticipants = Number(newMax);
      }

      const res = await fetch("/api/admin/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(
          resData.error ||
            (ar ? "تعذر إنشاء الجلسة." : "Erreur lors de la création.")
        );
      }

      setNewlyCreatedCode(resData.session?.code ?? null);
      setNewLabel("");
      setNewMax("");
      setRefresh((v) => v + 1);
      setToast(
        ar
          ? "تم إنشاء الجلسة بنجاح وتوليد الرمز."
          : "Session créée avec succès !"
      );
    } catch (err) {
      setCreateError(
        err instanceof Error
          ? err.message
          : ar
          ? "حدث خطأ غير متوقع."
          : "Une erreur est survenue."
      );
    } finally {
      setCreating(false);
    }
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  }

  return (
    <div data-admin-sessions className="ad-dashboard">
      <PageHeader
        title={c.sessions[lang]}
        description={
          ar
            ? "إنشاء وإدارة جلسات التقييم الجماعية بالرموز، وتتبع المشاركين."
            : "Créez et gérez les sessions organisées avec un code d'accès à 6 caractères."
        }
      >
        <Button
          onClick={() => {
            setNewlyCreatedCode(null);
            setCreateError(null);
            setModalOpen(true);
          }}
          variant="primary"
        >
          <Plus size={16} aria-hidden="true" />
          {c.newSession[lang]}
        </Button>
        <Button
          disabled={loading}
          aria-label={c.refresh[lang]}
          onClick={() => setRefresh((v) => v + 1)}
        >
          <RefreshCw
            size={16}
            className={loading ? "ad-spin" : ""}
            aria-hidden="true"
          />
          {c.refresh[lang]}
        </Button>
      </PageHeader>

      {error ? (
        <AdminError ar={ar} retry={() => setRefresh((v) => v + 1)} />
      ) : !data ? (
        <AdminLoading ar={ar} />
      ) : (
        <>
          <dl className="ad-stats" aria-busy={loading}>
            <StatCard
              label={ar ? "إجمالي الجلسات" : "Total sessions"}
              value={data.stats.totalSessions.toLocaleString(
                ar ? "ar-MA" : "fr-FR"
              )}
              note={ar ? "جلسات منشأة" : "Sessions créées"}
              lead
            />
            <StatCard
              label={ar ? "جلسات مفتوحة" : "Sessions ouvertes"}
              value={data.stats.openSessions.toLocaleString(
                ar ? "ar-MA" : "fr-FR"
              )}
              note={ar ? "تستقبل المشاركين" : "Acceptent des étudiants"}
            />
            <StatCard
              label={ar ? "جلسات مغلقة" : "Sessions fermées"}
              value={data.stats.closedSessions.toLocaleString(
                ar ? "ar-MA" : "fr-FR"
              )}
              note={ar ? "مكتملة أو مؤرشفة" : "Accès clôturé"}
            />
            <StatCard
              label={ar ? "مشاركو الجلسات" : "Participants en session"}
              value={data.stats.totalParticipants.toLocaleString(
                ar ? "ar-MA" : "fr-FR"
              )}
              note={ar ? "عبر رموز الدخول" : "Via les codes 6 caractères"}
            />
          </dl>

          <FilterBar label={c.filters[lang]}>
            <div className="ad-filters-main">
              <FormField
                id="session-search"
                label={ar ? "البحث بالاسم" : "Rechercher par nom"}
              >
                <input
                  id="session-search"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder={
                    ar ? "اسم الجلسة…" : "Nom de la session…"
                  }
                  maxLength={100}
                />
              </FormField>

              <FormField id="session-status" label={c.sessionStatus[lang]}>
                <select
                  id="session-status"
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="ALL">
                    {ar ? "كل الحالات" : "Tous les statuts"}
                  </option>
                  <option value="OPEN">
                    {ar ? "مفتوحة" : "Ouvertes"}
                  </option>
                  <option value="CLOSED">
                    {ar ? "مغلقة" : "Fermées"}
                  </option>
                  <option value="DRAFT">
                    {ar ? "مسودة" : "Brouillons"}
                  </option>
                </select>
              </FormField>
            </div>
          </FilterBar>

          <section className="ad-list-panel">
            {data.sessions.length ? (
              <div className="ad-table-wrap">
                <table className="ad-table">
                  <thead>
                    <tr>
                      <th>{c.sessionName[lang]}</th>
                      <th>{c.sessionCode[lang]}</th>
                      <th>{c.sessionStatus[lang]}</th>
                      <th>{c.capacity[lang]}</th>
                      <th>{c.created[lang]}</th>
                      <th className="text-end">{c.actions[lang]}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sessions.map((s) => {
                      const isOpen = s.status === "OPEN";
                      const isUpdating = updatingId === s.id;
                      return (
                        <tr key={s.id}>
                          <td>
                            <strong className="block font-semibold text-slate-900">
                              {s.label}
                            </strong>
                            {s.description && (
                              <span className="text-xs text-slate-500 block truncate max-w-xs">
                                {s.description}
                              </span>
                            )}
                          </td>
                          <td>
                            <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1">
                              <KeyRound
                                size={14}
                                className="text-brand-blue-700"
                              />
                              <span className="font-mono text-sm font-bold tracking-wider text-slate-800">
                                {s.code}
                              </span>
                              <button
                                type="button"
                                onClick={() => copyCode(s.code)}
                                title={c.copyCode[lang]}
                                className="ml-1 p-0.5 text-slate-400 hover:text-brand-blue-700 transition-colors"
                              >
                                {copiedCode === s.code ? (
                                  <Check
                                    size={14}
                                    className="text-emerald-600"
                                  />
                                ) : (
                                  <Copy size={14} />
                                )}
                              </button>
                            </div>
                          </td>
                          <td>
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                                isOpen
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : s.status === "CLOSED"
                                  ? "bg-slate-100 text-slate-600 border border-slate-200"
                                  : "bg-amber-50 text-amber-700 border border-amber-200"
                              }`}
                            >
                              {isOpen ? (
                                <Unlock size={12} />
                              ) : (
                                <Lock size={12} />
                              )}
                              <span>
                                {s.status === "OPEN"
                                  ? ar
                                    ? "مفتوحة"
                                    : "Ouverte"
                                  : s.status === "CLOSED"
                                  ? ar
                                    ? "مغلقة"
                                    : "Fermée"
                                  : s.status}
                              </span>
                            </span>
                          </td>
                          <td>
                            <span className="text-sm font-medium text-slate-700">
                              {s.participantsCount}
                              {s.maxParticipants
                                ? ` / ${s.maxParticipants}`
                                : ` (${c.unlimited[lang]})`}
                            </span>
                          </td>
                          <td>
                            <span className="text-xs text-slate-500">
                              {adminDate(s.createdAt, lang)}
                            </span>
                          </td>
                          <td className="text-end">
                            <Button
                              variant={isOpen ? "secondary" : "primary"}
                              disabled={isUpdating}
                              onClick={() => toggleStatus(s)}
                            >
                              {isOpen ? (
                                <>
                                  <Lock size={14} aria-hidden="true" />
                                  {c.closeSession[lang]}
                                </>
                              ) : (
                                <>
                                  <Unlock size={14} aria-hidden="true" />
                                  {c.openSession[lang]}
                                </>
                              )}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title={
                  ar
                    ? "لم يتم العثور على أي جلسة"
                    : "Aucune session trouvée"
                }
                body={
                  ar
                    ? "أنشئ أول جلسة لإتاحة رمز دمج للمشاركين."
                    : "Créez votre première session pour générer un code d'accès étudiant."
                }
              >
                <Button
                  variant="primary"
                  onClick={() => {
                    setNewlyCreatedCode(null);
                    setCreateError(null);
                    setModalOpen(true);
                  }}
                >
                  <Plus size={16} aria-hidden="true" />
                  {c.newSession[lang]}
                </Button>
              </EmptyState>
            )}

            {data.pagination.totalPages > 1 && (
              <div className="ad-pagination">
                <span>
                  {c.page[lang]} {page} {c.of[lang]}{" "}
                  {data.pagination.totalPages}
                </span>
                <div>
                  <Button
                    disabled={page <= 1}
                    onClick={() => setPage((v) => v - 1)}
                  >
                    {c.previous[lang]}
                  </Button>
                  <Button
                    disabled={page >= data.pagination.totalPages}
                    onClick={() => setPage((v) => v + 1)}
                  >
                    {c.next[lang]}
                  </Button>
                </div>
              </div>
            )}
          </section>
        </>
      )}

      {/* Modal Création de session */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-slate-900 mb-2">
              {c.newSession[lang]}
            </h2>
            <p className="text-xs text-slate-500 mb-5">
              {ar
                ? "سيتم توليد رمز فريد من 6 أحرف تلقائياً للجلسة."
                : "Un code unique à 6 caractères sera généré automatiquement."}
            </p>

            {newlyCreatedCode ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-800 mb-1">
                  {ar ? "رمز الجلسة المنشأ" : "Code de session généré"}
                </p>
                <div className="my-3 font-mono text-3xl font-black tracking-widest text-emerald-950 select-all">
                  {newlyCreatedCode}
                </div>
                <Button
                  variant="primary"
                  onClick={() => copyCode(newlyCreatedCode)}
                >
                  {copiedCode === newlyCreatedCode ? (
                    <>
                      <Check size={16} />
                      {c.copied[lang]}
                    </>
                  ) : (
                    <>
                      <Copy size={16} />
                      {c.copyCode[lang]}
                    </>
                  )}
                </Button>
                <div className="mt-4 pt-3 border-t border-emerald-200/60">
                  <Button onClick={() => setModalOpen(false)}>
                    {c.close[lang]}
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateSession} className="space-y-4">
                {createError && (
                  <p
                    role="alert"
                    className="rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700"
                  >
                    {createError}
                  </p>
                )}

                <div>
                  <label
                    htmlFor="new-session-label"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
                    {c.sessionName[lang]} *
                  </label>
                  <input
                    id="new-session-label"
                    required
                    minLength={3}
                    maxLength={160}
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder={
                      ar
                        ? "مثال: ورشة الإدماج المهني - الدفعة 1"
                        : "Ex: Atelier Insertion - Promo Nov"
                    }
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-brand-blue-700 focus:outline-none focus:ring-2 focus:ring-brand-blue-700/10"
                  />
                </div>

                <div>
                  <label
                    htmlFor="new-session-max"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
                    {c.capacity[lang]} (
                    {ar ? "اختياري" : "optionnel"})
                  </label>
                  <input
                    id="new-session-max"
                    type="number"
                    min={1}
                    max={1000}
                    value={newMax}
                    onChange={(e) => setNewMax(e.target.value)}
                    placeholder={ar ? "فارغ = غير محدود" : "Vide = illimité"}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-brand-blue-700 focus:outline-none focus:ring-2 focus:ring-brand-blue-700/10"
                  />
                </div>

                <div className="flex justify-end gap-2.5 pt-4 border-t border-slate-100">
                  <Button
                    type="button"
                    disabled={creating}
                    onClick={() => setModalOpen(false)}
                  >
                    {c.cancel[lang]}
                  </Button>
                  <Button type="submit" variant="primary" disabled={creating}>
                    {creating
                      ? ar
                        ? "جارٍ الإنشاء…"
                        : "Création…"
                      : c.newSession[lang]}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      <Toast message={toast} />
    </div>
  );
}
