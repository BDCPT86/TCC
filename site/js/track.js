/* TCC order tracking — public store.trackOrder lookup by order # + email. */
const WORKER_URL = 'https://tcc-admin.bydaries.workers.dev';

async function callWorker(action, payload) {
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload })
  });
  const raw = await res.text();
  let data = {};
  try { data = JSON.parse(raw); } catch (e) { /* non-JSON */ }
  if (!res.ok) throw new Error(data.error || raw || ('HTTP ' + res.status));
  return data;
}

const { createApp } = Vue;

createApp({
  data() {
    return { orderNo: '', email: '', loading: false, error: '', result: null };
  },
  mounted() {
    // Deep-link support: /track.html?order=13&email=... prefills and looks up.
    const q = new URLSearchParams(location.search);
    if (q.get('order')) this.orderNo = q.get('order');
    if (q.get('email')) this.email = q.get('email');
    if (this.orderNo && this.email) this.lookup();
  },
  methods: {
    async lookup() {
      if (!this.orderNo || !this.email) return;
      this.loading = true; this.error = ''; this.result = null;
      try {
        this.result = await callWorker('store.trackOrder', { orderNo: this.orderNo, email: this.email });
      } catch (e) {
        this.error = e.message || 'Could not find that order.';
      } finally {
        this.loading = false;
      }
    },
    stepClass(idx) {
      if (!this.result) return '';
      const s = this.result.statusStep;
      if (idx < s) return 'done';
      if (idx === s) return 'current';
      return '';
    },
    fmtDate(iso) {
      if (!iso) return '';
      try {
        return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
      } catch (e) { return ''; }
    }
  }
}).mount('#track');
