"use client";
/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import { adminHeaders, api } from "@/lib/client/api";

interface AdminLink {
  id: string;
  kind: "fun" | "edu";
  video_id: string;
  url?: string;
  title: string;
  topic: string;
  difficulty: number;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
  active: boolean;
  embeddable?: boolean | null;
}

const EMPTY = {
  kind: "edu",
  url: "",
  title: "",
  topic: "math",
  difficulty: 1,
  question: "",
  options: ["", "", "", ""],
  correct_index: 0,
  explanation: "",
};

export default function AdminPage() {
  const [pw, setPw] = useState<string | null>(null);
  const [pwInput, setPwInput] = useState("");
  const [links, setLinks] = useState<AdminLink[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<any>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [csv, setCsv] = useState("");
  const [importResult, setImportResult] = useState<{ imported: number; rejected: { line: number; error: string }[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setPw(sessionStorage.getItem("sg_admin_pw"));
  }, []);

  const call = useCallback(async (path: string, init?: { method?: string; body?: unknown }) => {
    const r = await api(path, { ...init, headers: adminHeaders() });
    if (r.status === 401 || r.status === 403) {
      sessionStorage.removeItem("sg_admin_pw");
      setPw(null);
      setError("Wrong admin password");
    }
    return r;
  }, []);

  const load = useCallback(async () => {
    const r = await call("/api/admin/links");
    if (r.ok) {
      const d = r.data;
      setLinks(Array.isArray(d) ? d : (d?.links ?? []));
    }
  }, [call]);

  useEffect(() => {
    if (pw) load();
  }, [pw, load]);

  if (!pw) {
    return (
      <form
        className="mx-auto mt-16 flex w-full max-w-sm flex-col gap-3 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          sessionStorage.setItem("sg_admin_pw", pwInput);
          setError(null);
          setPw(pwInput);
        }}
      >
        <h1 className="text-xl font-bold">Admin</h1>
        <input
          data-testid="admin-password"
          type="password"
          className="input"
          placeholder="Admin password"
          value={pwInput}
          onChange={(e) => setPwInput(e.target.value)}
        />
        <button data-testid="admin-login" className="btn-primary" type="submit">
          Sign in
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    );
  }

  const saveEdit = async () => {
    const r = await call(`/api/admin/links/${draft.id}`, { method: "PATCH", body: draft });
    setMsg(r.ok ? "Saved" : `Error: ${errText(r.data)}`);
    if (r.ok) {
      setEditing(null);
      load();
    }
  };
  const remove = async (id: string) => {
    if (!confirm("Delete this link?")) return;
    await call(`/api/admin/links/${id}`, { method: "DELETE" });
    load();
  };
  const verify = async (id: string) => {
    const r = await call("/api/admin/verify", { body: { id } });
    setMsg(r.ok ? `Verify: ${JSON.stringify(r.data)}` : `Error: ${errText(r.data)}`);
    load();
  };
  const add = async () => {
    const body = { ...form, options: form.options.filter((o: string) => o.trim() !== "") };
    const r = await call("/api/admin/links", { body });
    setMsg(r.ok ? "Added" : `Error: ${errText(r.data)}`);
    if (r.ok) {
      setForm(EMPTY);
      load();
    }
  };
  const doImport = async () => {
    const r = await call("/api/admin/import", { body: { csv } });
    if (r.ok) {
      setImportResult({ imported: r.data?.imported ?? 0, rejected: r.data?.rejected ?? [] });
      load();
    } else setMsg(`Import error: ${errText(r.data)}`);
  };

  return (
    <div className="flex w-full flex-col gap-8 p-6">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold">Links admin</h1>
        <button
          className="btn-secondary text-sm"
          onClick={() => {
            sessionStorage.removeItem("sg_admin_pw");
            setPw(null);
          }}
        >
          Sign out
        </button>
        {msg && (
          <span data-testid="admin-msg" className="text-sm text-neutral-400">
            {msg}
          </span>
        )}
      </div>

      <section className="overflow-x-auto">
        <table data-testid="links-table" className="w-full text-left text-sm">
          <thead className="text-neutral-400">
            <tr>
              <th className="p-2">Kind</th>
              <th className="p-2">Video</th>
              <th className="p-2">Title</th>
              <th className="p-2">Topic</th>
              <th className="p-2">Question</th>
              <th className="p-2">Options (correct marked)</th>
              <th className="p-2">Active</th>
              <th className="p-2">Embeddable</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {links.map((l) =>
              editing === l.id && draft ? (
                <tr key={l.id} data-testid="link-row" className="border-t border-neutral-800 align-top">
                  <td className="p-2">{l.kind}</td>
                  <td className="p-2 font-mono">{l.video_id}</td>
                  <td className="p-2">
                    <input className="input w-full" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                  </td>
                  <td className="p-2">
                    <input className="input w-24" value={draft.topic} onChange={(e) => setDraft({ ...draft, topic: e.target.value })} />
                  </td>
                  <td className="p-2">
                    <textarea className="input w-full" value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} />
                    <textarea
                      className="input mt-1 w-full"
                      placeholder="Explanation"
                      value={draft.explanation}
                      onChange={(e) => setDraft({ ...draft, explanation: e.target.value })}
                    />
                  </td>
                  <td className="p-2">
                    {draft.options.map((o: string, i: number) => (
                      <div key={i} className="flex items-center gap-1">
                        <input
                          type="radio"
                          checked={draft.correct_index === i}
                          onChange={() => setDraft({ ...draft, correct_index: i })}
                        />
                        <input
                          className="input w-full"
                          value={o}
                          onChange={(e) => {
                            const options = [...draft.options];
                            options[i] = e.target.value;
                            setDraft({ ...draft, options });
                          }}
                        />
                      </div>
                    ))}
                  </td>
                  <td className="p-2">
                    <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                  </td>
                  <td className="p-2">{String(l.embeddable ?? "?")}</td>
                  <td className="flex gap-1 p-2">
                    <button className="btn-primary text-xs" onClick={saveEdit}>
                      Save
                    </button>
                    <button className="btn-secondary text-xs" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={l.id} data-testid="link-row" className="border-t border-neutral-800 align-top">
                  <td className="p-2">{l.kind}</td>
                  <td className="p-2 font-mono">{l.video_id}</td>
                  <td className="p-2">{l.title}</td>
                  <td className="p-2">{l.topic}</td>
                  <td className="p-2">{l.question}</td>
                  <td className="p-2">
                    {l.options?.map((o, i) => (
                      <div key={i} className={i === l.correct_index ? "text-green-400" : ""}>
                        {i === l.correct_index ? "* " : ""}
                        {o}
                      </div>
                    ))}
                  </td>
                  <td className="p-2">{l.active ? "yes" : "no"}</td>
                  <td className="p-2">{String(l.embeddable ?? "?")}</td>
                  <td className="flex gap-1 p-2">
                    <button
                      className="btn-secondary text-xs"
                      onClick={() => {
                        setEditing(l.id);
                        setDraft({ ...l, options: [...(l.options ?? [])] });
                      }}
                    >
                      Edit
                    </button>
                    <button data-testid="verify" className="btn-secondary text-xs" onClick={() => verify(l.id)}>
                      Verify
                    </button>
                    <button className="btn-secondary text-xs" onClick={() => remove(l.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </section>

      <section className="flex max-w-2xl flex-col gap-2 rounded-2xl bg-neutral-900 p-5">
        <h2 className="text-lg font-semibold">Add one</h2>
        <div className="grid grid-cols-2 gap-2">
          <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="edu">edu</option>
            <option value="fun">fun</option>
          </select>
          <input className="input" placeholder="YouTube URL or ID" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          <input className="input" placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input className="input" placeholder="Topic" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} />
          <select className="input" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: Number(e.target.value) })}>
            <option value={1}>difficulty 1</option>
            <option value={2}>difficulty 2</option>
            <option value={3}>difficulty 3</option>
          </select>
          <select className="input" value={form.correct_index} onChange={(e) => setForm({ ...form, correct_index: Number(e.target.value) })}>
            {[0, 1, 2, 3].map((i) => (
              <option key={i} value={i}>
                correct: option {i + 1}
              </option>
            ))}
          </select>
        </div>
        <textarea className="input" placeholder="Question" value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} />
        {form.options.map((o: string, i: number) => (
          <input
            key={i}
            className="input"
            placeholder={`Option ${i + 1}`}
            value={o}
            onChange={(e) => {
              const options = [...form.options];
              options[i] = e.target.value;
              setForm({ ...form, options });
            }}
          />
        ))}
        <textarea className="input" placeholder="Explanation" value={form.explanation} onChange={(e) => setForm({ ...form, explanation: e.target.value })} />
        <button className="btn-primary" onClick={add}>
          Add link
        </button>
      </section>

      <section className="flex max-w-3xl flex-col gap-2 rounded-2xl bg-neutral-900 p-5">
        <h2 className="text-lg font-semibold">CSV import</h2>
        <p className="font-mono text-xs text-neutral-400">
          kind,video_id_or_url,title,topic,difficulty,question,option1,option2,option3,option4,correct_index,explanation
        </p>
        <textarea
          data-testid="csv-input"
          className="input h-40 font-mono"
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
        />
        <button data-testid="csv-import" className="btn-primary" onClick={doImport}>
          Import
        </button>
        {importResult && (
          <div data-testid="import-result" className="text-sm">
            <p>
              Imported <span data-testid="imported-count">{importResult.imported}</span> rows.
            </p>
            {importResult.rejected.length > 0 && (
              <ul data-testid="rejected" className="mt-1 list-disc pl-5 text-red-400">
                {importResult.rejected.map((r, i) => (
                  <li key={i} data-testid="rejected-row">
                    Line {r.line}: {r.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function errText(d: any): string {
  if (!d) return "unknown";
  return d.message ?? d.error ?? JSON.stringify(d);
}
