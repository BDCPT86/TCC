/* TCC Club Shop — Vue 3 storefront (mounts on #shop)
   Talks to the tcc-admin Worker: store.catalogue + store.checkout.
   Checkout is MOCK until a gateway account exists — the Worker
   returns a mock redirect that resolves the order immediately. */
const { createApp, computed } = Vue;

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

createApp({
  data() {
    return {
      products: [],
      loading: true,
      loadError: false,
      chosenVariant: {},     // productId -> variantId
      cart: [],
      cartOpen: false,
      buyer: { name: '', email: '', phone: '' },
      paymentMethod: 'payfast',
      paying: false,
      checkoutErr: '',
      placed: null,
      activeCategory: 'all'
    };
  },
  computed: {
    cartCount() { return this.cart.reduce((n, i) => n + i.qty, 0); },
    totalCents() { return this.cart.reduce((n, i) => n + i.unitCents * i.qty, 0); },
    categories() {
      // Distinct, non-empty categories in a stable order (as they first appear).
      const seen = [];
      for (const p of this.products) {
        const c = (p.category || '').trim();
        if (c && !seen.includes(c)) seen.push(c);
      }
      return seen;
    },
    visibleProducts() {
      if (this.activeCategory === 'all') return this.products;
      return this.products.filter(p => (p.category || '').trim() === this.activeCategory);
    }
  },
  async mounted() {
    try {
      const data = await callWorker('store.catalogue', {});
      // Worker returns the raw PostgREST array
      this.products = Array.isArray(data) ? data : (data.products || []);
    } catch (e) {
      this.loadError = true;
      console.error('store: catalogue load failed', e);
    } finally {
      this.loading = false;
    }
  },
  methods: {
    rand(cents) { return (cents / 100).toFixed(2); },
    soldOut(p) {
      if (p.has_variants) return (p.product_variants || []).every(v => v.stock < 1);
      return false; // simple products: stock managed later / unlimited for now
    },
    variantOf(p) {
      if (!p.has_variants) return null;
      const vid = this.chosenVariant[p.id];
      return (p.product_variants || []).find(v => v.id === vid) || null;
    },
    addToCart(p) {
      let variant = null, label = p.name, unit = p.price_cents;
      if (p.has_variants) {
        variant = this.variantOf(p);
        if (!variant) { alert('Please choose a size first.'); return; }
        label = p.name + ' — ' + variant.label;
        if (variant.price_cents != null) unit = variant.price_cents;
      }
      const key = p.id + '|' + (variant ? variant.id : '');
      const existing = this.cart.find(i => i.key === key);
      if (existing) existing.qty++;
      else this.cart.push({ key, productId: p.id, variantId: variant ? variant.id : null,
                            label, unitCents: unit, qty: 1 });
      this.cartOpen = true;
    },
    bump(i, d) {
      this.cart[i].qty += d;
      if (this.cart[i].qty < 1) this.cart.splice(i, 1);
    },
    async checkout() {
      this.checkoutErr = '';
      if (!this.buyer.name || !this.buyer.email) {
        this.checkoutErr = 'Please add your name and email.'; return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.buyer.email)) {
        this.checkoutErr = 'That email doesn\u2019t look right.'; return;
      }
      this.paying = true;
      try {
        const resp = await callWorker('store.checkout', {
          buyerName: this.buyer.name,
          buyerEmail: this.buyer.email,
          buyerPhone: this.buyer.phone || null,
          paymentMethod: this.paymentMethod,
          items: this.cart.map(i => ({ productId: i.productId, variantId: i.variantId, qty: i.qty }))
        });

        if (resp.cash) {
          // Cash at clubhouse — order placed, pay on collection.
          this.placed = { orderNo: resp.orderNo || resp.orderId.slice(0, 8), cash: true };
          this.cart = [];
        } else if (resp.payfast) {
          // PayFast needs a POST to its hosted checkout — build and submit a form.
          var form = document.createElement('form');
          form.method = 'POST';
          form.action = resp.processUrl;
          Object.keys(resp.fields).forEach(function (k) {
            var input = document.createElement('input');
            input.type = 'hidden';
            input.name = k;
            input.value = resp.fields[k];
            form.appendChild(input);
          });
          document.body.appendChild(form);
          form.submit();          // leaves the page → PayFast checkout
          return;
        } else if (resp.mock) {
          // Mock path (only if PF_MOCK=true on the Worker) — confirm inline.
          await callWorker('store.mockConfirm', { paymentId: resp.paymentId });
          this.placed = { orderNo: resp.orderId.slice(0, 8) };
          this.cart = [];
        } else if (resp.redirectUrl) {
          window.location.href = resp.redirectUrl;
        } else {
          throw new Error('Checkout didn\u2019t return a payment link.');
        }
      } catch (e) {
        this.checkoutErr = 'Checkout failed: ' + e.message;
        console.error('store: checkout failed', e);
      } finally {
        this.paying = false;
      }
    }
  }
}).mount('#shop');
