'use client';

import { useEffect } from 'react';
import { ModalCloseButton } from '@/components/ModalCloseButton';

type GuideStep = {
  id: string;
  title: string;
  summary: string;
  image: string;
  imageAlt: string;
  points: string[];
};

const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'open',
    title: '1. Open MCP & start capture',
    summary:
      'Name your test case, optionally set functionality/description/start path, then open the live MCP browser to begin recording.',
    image: '/guide/mcp-guide-01-open.png',
    imageAlt: 'MCP click flow modal with Open MCP view button',
    points: [
      'Test case name is required — other fields auto-fill if left blank.',
      'Start path (e.g. /buyer/products) controls where the portal opens.',
      'AI model Auto switches free models if one fails.',
      'Click “Open MCP view & start capture” to launch the live browser.',
    ],
  },
  {
    id: 'login',
    title: '2. Login & enter details in MCP',
    summary:
      'Use Login in MCP for credentials, or click fields in the live view and type — every action is captured for the test case.',
    image: '/guide/mcp-guide-02-login.png',
    imageAlt: 'MCP login panel and live browser with login form',
    points: [
      'Enter email/mobile + password → Login in MCP (or Open /login).',
      'Credentials prefill from header “Set credentials” when available.',
      'Click a field in the live view, then type on the keyboard (view must be focused).',
      'Or use Fill / Tab / Enter / Scroll / Go for precise control.',
      'Captured events appear in the sidebar list.',
    ],
  },
  {
    id: 'flowchart',
    title: '3. Edit flow chart + Positive / Negative fork',
    summary:
      'On any step, add a Positive / Negative fork: define what each path means and which steps go next. Drag steps (⋮⋮) to reorder.',
    image: '/guide/mcp-guide-03-flowchart.png',
    imageAlt: 'Flow chart editor with fork and drag handles',
    points: [
      'Select a step → “Add Positive / Negative fork”.',
      'Positive definition = happy path (where flow goes on success).',
      'Negative definition = error path (where flow goes on fail / invalid).',
      'Add steps under each arm; drag ⋮⋮ to reorder within the trunk or a branch.',
      'Saving builds both suite cases from the shared trunk + each arm.',
    ],
  },
  {
    id: 'validate',
    title: '4. Generate, validate & save both',
    summary:
      'Generate creates Positive + Negative in the same suite. Open Suite chart (both) to see one diagram with two branches.',
    image: '/guide/mcp-guide-04-validate.png',
    imageAlt: 'Suite chart with Positive and Negative branches',
    points: [
      'Generate → AI builds Positive (happy path) and Negative (error path) in one group/pair.',
      'Suite chart tab shows both branches together under one Start.',
      'Edit branch to change steps for the selected polarity; both stay in the same suite.',
      'AI validate checks if the case is proper (score + issues + suggestions).',
      'Review & save both → preview → save to the flow library as one suite pair.',
      'Run reports show polarity badges and a pass/fail flow chart (also in PDF).',
    ],
  },
];

const KEY_POINTS = [
  {
    title: 'Name is enough',
    body: 'Only the test case name is required. Description, tags, and estimated time are auto-set from the recording and name.',
  },
  {
    title: 'One combined suite (not two cases)',
    body: 'Matching Positive/Negative cases in the same group/pair merge into one library suite with a forked flow chart. Upload, AI generate, MCP, and validate all use this.',
  },
  {
    title: 'One suite chart, two branches',
    body: 'Positive and Negative share the same group/pair. The Suite chart shows both paths in one diagram — not two separate suites.',
  },
  {
    title: 'MCP = live portal',
    body: 'The MCP view is a live Playwright screencast. Clicks, fills, login, and keyboard typing are recorded as steps.',
  },
  {
    title: 'AI model (Auto)',
    body: 'Use Auto unless you need a specific free model. Auto rotates free OpenRouter models if one fails. Prefer coder/report-rated models for generate & validate.',
  },
  {
    title: 'Flow chart is editable',
    body: 'After capture (and after generate), edit the flow chart — the test case steps update to match.',
  },
  {
    title: 'Reports include the chart',
    body: 'Each run attaches a pass/fail flow chart and positive/negative badge to the report UI and PDF download.',
  },
  {
    title: 'Shortcuts while recording',
    body: 'Click the MCP panel to focus · type to fill · Tab / Enter / Backspace · Fill box · Login in MCP · Go to path.',
  },
];

export function McpClickFlowGuideModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="report-modal-root mcp-guide-root"
      role="dialog"
      aria-modal="true"
      aria-label="MCP click flow usage guide"
    >
      <div className="report-modal-backdrop" onClick={onClose} />
      <div className="ai-action-modal mcp-guide-modal">
        <div className="ai-action-modal-header">
          <div className="modal-header-copy">
            <h2>How to use · MCP click flow</h2>
            <p className="field-hint" style={{ margin: 0 }}>
              Step-by-step guide with images — capture, login, edit flow chart, generate Positive +
              Negative, validate, and save.
            </p>
          </div>
          <ModalCloseButton onClick={onClose} />
        </div>

        <div className="ai-action-modal-body mcp-guide-body">
          <section className="mcp-guide-keypoints">
            <h3 className="tc-detail-subhead">Key points</h3>
            <ul className="mcp-guide-key-grid">
              {KEY_POINTS.map((k) => (
                <li key={k.title}>
                  <strong>{k.title}</strong>
                  <p>{k.body}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="mcp-guide-steps">
            <h3 className="tc-detail-subhead">Walkthrough</h3>
            {GUIDE_STEPS.map((step, idx) => (
              <article key={step.id} className="mcp-guide-step" id={`mcp-guide-${step.id}`}>
                <div className="mcp-guide-step-copy">
                  <span className="mcp-guide-step-num">{idx + 1}</span>
                  <div>
                    <h4>{step.title}</h4>
                    <p>{step.summary}</p>
                    <ul>
                      {step.points.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <figure className="mcp-guide-step-figure">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={step.image} alt={step.imageAlt} />
                  <figcaption>{step.imageAlt}</figcaption>
                </figure>
              </article>
            ))}
          </section>

          <section className="mcp-guide-models" id="mcp-guide-models">
            <h3 className="tc-detail-subhead">AI model tips</h3>
            <ul className="mcp-guide-models-list">
              <li>
                <strong>Auto (recommended)</strong>
                <p>Tries free models in order until generate/validate succeeds. Best default for MCP click flow.</p>
              </li>
              <li>
                <strong>Coder / high ★ models</strong>
                <p>Use for harder flows when Auto struggles — pick a ★★★★★ coder/report model from the list.</p>
              </li>
              <li>
                <strong>Where to choose</strong>
                <p>
                  MCP sidebar → AI model → ⓘ Info for ratings, or the header model picker on the main AI
                  panel.
                </p>
              </li>
            </ul>
          </section>

          <section className="mcp-guide-checklist">
            <h3 className="tc-detail-subhead">Quick checklist</h3>
            <ol>
              <li>Set portal URL (and role credentials in the header if you need login).</li>
              <li>Open MCP click flow → enter a name → Open MCP view &amp; start capture.</li>
              <li>Login in MCP or click + type to walk the portal flow.</li>
              <li>Edit Flow chart if needed → Generate test case.</li>
              <li>Review Positive / Negative → AI validate → Review &amp; save both.</li>
            </ol>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Got it — back to MCP
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
