interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

export class TokenManager {
  private accessToken: string | null = null;
  private expiresAt = 0;

  constructor(
    private readonly tokenUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly scope: string,
  ) {}

  invalidate(): void {
    this.accessToken = null;
    this.expiresAt = 0;
  }

  async getToken(signal?: AbortSignal): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: this.scope,
      grant_type: "client_credentials",
    });

    const response = await fetch(this.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal,
    });

    if (!response.ok) {
      throw new Error(`BarentsWatch token request failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as Partial<TokenResponse>;
    if (!payload.access_token || !payload.expires_in) {
      throw new Error("BarentsWatch token response is missing required fields");
    }

    this.accessToken = payload.access_token;
    this.expiresAt = Date.now() + payload.expires_in * 1_000;
    return this.accessToken;
  }
}
