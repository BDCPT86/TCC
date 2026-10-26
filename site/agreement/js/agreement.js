/* ============================================================
   agreement.js — Confidentiality Undertaking signing page
   Vanilla JS. Depends on signature_pad (loaded in HTML).

   BEFORE GOING LIVE — set one line:
     API_BASE  → your Worker origin
   The confirmation email is sent by the Worker (which already holds the
   EmailJS secrets), and the authoritative record is saved server-side, so
   a failed email never blocks a successful signature.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- CONFIG ---------- */
  const API_BASE = "https://tcc-admin.bydaries.workers.dev";
  // The confirmation email is sent by the Worker, which already holds the
  // EmailJS secrets in Cloudflare — nothing to configure here.

  /* ---------- State ---------- */
  let agreement = null; // { version, text, consentText, effective }
  let signaturePad = null;
  let sigMode = "drawn"; // 'drawn' | 'typed'

  /* ---------- Elements ---------- */
  const $ = (id) => document.getElementById(id);
  const els = {
    versionLabel: $("agreement-version-label"),
    text: $("agreement-text"),
    consentText: $("consent-text"),
    name: $("signer-name"),
    email: $("signer-email"),
    role: $("signer-role"),
    tabDraw: $("tab-draw"),
    tabType: $("tab-type"),
    sigDraw: $("sig-draw"),
    sigType: $("sig-type"),
    canvas: $("sig-canvas"),
    sigClear: $("sig-clear"),
    typed: $("sig-typed"),
    consent: $("consent"),
    submit: $("submit-btn"),
    error: $("form-error"),
    signSection: document.querySelector(".agreement-sign"),
    docSection: document.querySelector(".agreement-doc"),
    success: $("success"),
    successBody: $("success-body"),
    download: $("download-btn"),
  };

  /* ---------- Load the current agreement ---------- */
  async function loadAgreement() {
    try {
      const res = await fetch(`${API_BASE}/api/agreement/current`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Load failed");
      agreement = data;
      renderAgreement();
    } catch (err) {
      els.text.innerHTML =
        '<p class="agreement-doc__loading">Could not load the undertaking. ' +
        "Please refresh, or contact the club if it keeps happening.</p>";
      els.versionLabel.textContent = "Unavailable";
      console.error("Agreement load error:", err);
    }
  }

  function renderAgreement() {
    els.versionLabel.textContent =
      "Version " + agreement.version + " · " + (agreement.effective || "");
    els.consentText.textContent = agreement.consentText;
    // Render as paragraphs, escaped.
    const frag = document.createDocumentFragment();
    agreement.text.split(/\n{2,}/).forEach((para) => {
      const p = document.createElement("p");
      p.textContent = para.replace(/\n/g, " ").trim();
      if (p.textContent) frag.appendChild(p);
    });
    els.text.innerHTML = "";
    els.text.appendChild(frag);
  }

  /* ---------- Signature pad ---------- */
  function initSignaturePad() {
    signaturePad = new window.SignaturePad(els.canvas, {
      penColor: "#111111",
      minWidth: 0.8,
      maxWidth: 2.2,
    });
    sizeCanvas();
    window.addEventListener("resize", sizeCanvas);
    els.sigClear.addEventListener("click", () => signaturePad.clear());
  }

  function sizeCanvas() {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const data = signaturePad ? signaturePad.toData() : null;
    els.canvas.width = els.canvas.offsetWidth * ratio;
    els.canvas.height = els.canvas.offsetHeight * ratio;
    els.canvas.getContext("2d").scale(ratio, ratio);
    if (signaturePad) {
      signaturePad.clear();
      if (data && data.length) signaturePad.fromData(data);
    }
  }

  function setSigMode(mode) {
    sigMode = mode;
    const drawing = mode === "drawn";
    els.tabDraw.classList.toggle("is-active", drawing);
    els.tabType.classList.toggle("is-active", !drawing);
    els.tabDraw.setAttribute("aria-selected", String(drawing));
    els.tabType.setAttribute("aria-selected", String(!drawing));
    els.sigDraw.hidden = !drawing;
    els.sigType.hidden = drawing;
    if (drawing) sizeCanvas();
  }

  /* ---------- Validation + submit ---------- */
  function showError(msg) {
    els.error.textContent = msg;
    els.error.hidden = false;
  }
  function clearError() {
    els.error.hidden = true;
    els.error.textContent = "";
  }

  function collectSignature() {
    if (sigMode === "typed") {
      const v = els.typed.value.trim();
      return v ? { type: "typed", data: v } : null;
    }
    if (signaturePad && !signaturePad.isEmpty()) {
      return { type: "drawn", data: signaturePad.toDataURL("image/png") };
    }
    return null;
  }

  async function submit() {
    clearError();
    if (!agreement) return showError("The undertaking hasn't loaded yet.");

    const name = els.name.value.trim();
    const email = els.email.value.trim();
    const role = els.role.value.trim();

    if (!name) return showError("Please enter your full name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return showError("Please enter a valid email address.");

    const sig = collectSignature();
    if (!sig)
      return showError(
        sigMode === "typed"
          ? "Please type your name as your signature."
          : "Please draw your signature."
      );

    if (!els.consent.checked)
      return showError("Please tick the box to confirm you agree.");

    els.submit.disabled = true;
    els.submit.textContent = "Signing…";

    try {
      const res = await fetch(`${API_BASE}/api/agreement/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name,
          email: email,
          role: role,
          signatureType: sig.type,
          signatureData: sig.data,
          consent: true,
          agreementVersion: agreement.version,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Signing failed");

      onSuccess({ name, email, role }, data);
    } catch (err) {
      console.error("Sign error:", err);
      showError("Something went wrong saving your signature. Please try again.");
      els.submit.disabled = false;
      els.submit.textContent = "Sign undertaking";
    }
  }

  function onSuccess(signer, result) {
    const when = new Date(result.signedAt).toLocaleString("en-ZA", {
      dateStyle: "long",
      timeStyle: "short",
    });
    els.docSection.hidden = true;
    els.signSection.hidden = true;
    els.successBody.textContent = result.alreadySigned
      ? "You have already signed this undertaking, on " +
        when +
        ". Nothing more to do. Reference: " +
        result.recordHash.slice(0, 12) +
        "."
      : "Thank you, " +
        signer.name +
        ". Your signature was recorded on " +
        when +
        ". A copy has been emailed to " +
        signer.email +
        ". Reference: " +
        result.recordHash.slice(0, 12) +
        ".";
    els.success.hidden = false;
    els.success.scrollIntoView({ behavior: "smooth", block: "start" });

    els.download.addEventListener("click", () =>
      downloadCopy(signer, result, when)
    );
  }

  /* ---------- Download a plain-text copy ---------- */
  function downloadCopy(signer, result, when) {
    const lines = [
      "TYGERBERG CRICKET CLUB — CONFIDENTIALITY UNDERTAKING",
      "",
      agreement.text,
      "",
      "----------------------------------------",
      "Signed by: " + signer.name,
      "Position:  " + (signer.role || "—"),
      "Email:     " + signer.email,
      "Signed at: " + when,
      "Version:   " + result.version,
      "Reference: " + result.recordHash,
      "",
      "Facta Non Verba.",
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "TCC-confidentiality-" + signer.name.replace(/\s+/g, "-") + ".txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /* ---------- Wire up ---------- */
  function init() {
    loadAgreement();
    initSignaturePad();
    els.tabDraw.addEventListener("click", () => setSigMode("drawn"));
    els.tabType.addEventListener("click", () => setSigMode("typed"));
    els.submit.addEventListener("click", submit);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
