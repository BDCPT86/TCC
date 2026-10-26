/**
 * Cloudflare Worker — TCC News OG Tag Injector
 * 
 * Deploy this as a Cloudflare Worker and route it to:
 *   tygerbergcc.co.za/news.html*
 *
 * It intercepts requests to news.html?id=... , fetches the article
 * from Supabase, and injects correct og:title, og:description and
 * og:image into the HTML before serving — so social crawlers see them.
 *
 * Setup steps (after deploying):
 *   1. Workers & Pages → Create Worker → paste this code → Deploy
 *   2. Workers & Pages → your worker → Settings → Triggers
 *   3. Add route: tygerbergcc.co.za/news.html* → your worker
 */

const SUPABASE_URL      = 'https://cgjannvzpqecwzjdzwso.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnamFubnZ6cHFlY3d6amR6d3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTQ2MzIsImV4cCI6MjA4ODk3MDYzMn0.tDzVTT1i8Cqzu1mGBM1tCxZHDuhVqX03efWiYcQLkH8';
const SITE_URL          = 'https://tygerbergcc.co.za';
const DEFAULT_IMAGE     = SITE_URL + '/images/tcc-logo.png';
const DEFAULT_TITLE     = 'News | Tygerberg Cricket Club';
const DEFAULT_DESC      = 'Latest news and updates from Tygerberg Cricket Club.';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const id  = url.searchParams.get('id');

    // No article ID — just pass through unchanged
    if (!id) {
      return fetch(request);
    }

    // Fetch the original HTML page and article from Supabase in parallel
    const [pageRes, articleRes] = await Promise.all([
      fetch(request),
      fetch(
        `${SUPABASE_URL}/rest/v1/news?id=eq.${id}&published=eq.true&select=title,content&limit=1`,
        { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
      )
    ]);

    // If the page fetch failed, return as-is
    if (!pageRes.ok) return pageRes;

    let ogTitle = DEFAULT_TITLE;
    let ogDesc  = DEFAULT_DESC;
    let ogImage = DEFAULT_IMAGE;

    if (articleRes.ok) {
      const rows = await articleRes.json();
      if (rows && rows.length > 0) {
        const article = rows[0];

        // Title
        ogTitle = article.title + ' | Tygerberg Cricket Club';

        // Description — strip HTML tags, take first 160 chars
        const plainText = article.content
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        ogDesc = plainText.length > 160
          ? plainText.substring(0, 157) + '…'
          : plainText;

        // Image — extract first <img src="..."> from content
        const imgMatch = article.content.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (imgMatch) ogImage = imgMatch[1];
      }
    }

    // Use HTMLRewriter to replace the OG tags in the <head>
    const rewriter = new HTMLRewriter()
      .on('meta[property="og:title"]',       new MetaReplacer('content', ogTitle))
      .on('meta[property="og:description"]', new MetaReplacer('content', ogDesc))
      .on('meta[property="og:image"]',       new MetaReplacer('content', ogImage))
      .on('link[rel="canonical"]',           new MetaReplacer('href', `${SITE_URL}/news.html?id=${id}`))
      .on('title',                           new TitleReplacer(ogTitle));

    return rewriter.transform(pageRes);
  }
};

class MetaReplacer {
  constructor(attr, value) {
    this.attr  = attr;
    this.value = value;
  }
  element(el) {
    el.setAttribute(this.attr, this.value);
  }
}

class TitleReplacer {
  constructor(title) {
    this.title = title;
    this.done  = false;
  }
  element(el) {
    if (!this.done) {
      el.setInnerContent(this.title);
      this.done = true;
    }
  }
}
