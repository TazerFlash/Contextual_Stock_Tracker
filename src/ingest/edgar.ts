// Minimal SEC EDGAR client. SEC requires a User-Agent with a contact (name + email)
// and allows at most 10 requests/second.

export interface FilingRef {
  ticker: string;
  company: string;
  cik: string;
  form: string;
  filedAt: string;
  url: string;
}

export class EdgarClient {
  constructor(private readonly userAgent: string) {
    if (!/\S+@\S+/.test(userAgent)) {
      throw new Error('SEC_USER_AGENT must include a contact email, e.g. "Jane Doe jane@example.com"');
    }
  }

  private async get(url: string): Promise<Response> {
    await new Promise((r) => setTimeout(r, 150));
    const res = await fetch(url, { headers: { "User-Agent": this.userAgent } });
    if (!res.ok) throw new Error(`SEC request failed: ${res.status} ${url}`);
    return res;
  }

  async lookupCik(ticker: string): Promise<{ cik: string; company: string }> {
    const res = await this.get("https://www.sec.gov/files/company_tickers.json");
    const table = (await res.json()) as Record<string, { cik_str: number; ticker: string; title: string }>;
    const row = Object.values(table).find((r) => r.ticker.toUpperCase() === ticker.toUpperCase());
    if (!row) throw new Error(`Unknown ticker: ${ticker}`);
    return { cik: String(row.cik_str).padStart(10, "0"), company: row.title };
  }

  /** The most recent filing of each requested form type. */
  async latestFilings(ticker: string, forms: string[]): Promise<FilingRef[]> {
    const { cik, company } = await this.lookupCik(ticker);
    const res = await this.get(`https://data.sec.gov/submissions/CIK${cik}.json`);
    const recent = ((await res.json()) as {
      filings: { recent: { accessionNumber: string[]; filingDate: string[]; form: string[]; primaryDocument: string[] } };
    }).filings.recent;

    return forms.flatMap((form) => {
      const i = recent.form.indexOf(form);
      if (i < 0) return [];
      const accession = recent.accessionNumber[i].replace(/-/g, "");
      return [{
        ticker: ticker.toUpperCase(),
        company,
        cik,
        form,
        filedAt: recent.filingDate[i],
        url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession}/${recent.primaryDocument[i]}`,
      }];
    });
  }

  async fetchDocument(url: string): Promise<string> {
    return (await this.get(url)).text();
  }
}
