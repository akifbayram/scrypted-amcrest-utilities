import {
  AuthFetchCredentialState,
  HttpFetchOptions,
  authHttpFetch,
} from "@scrypted/common/src/http-auth-fetch";
import xml2js from "xml2js";
import { Readable } from "stream";

// Helper function to delay execution.
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class AmcrestDahuaCameraAPI {
  credential: AuthFetchCredentialState;
  channel: string = "1";

  constructor(
    public ip: string,
    username: string,
    password: string,
    channel: string,
    public console: Console
  ) {
    this.credential = { username, password };
    if (channel) {
      this.channel = channel;
    }
  }

  async request(
    urlOrOptions: string | URL | HttpFetchOptions<Readable>,
    body?: Readable
  ) {
    const response = await authHttpFetch({
      ...typeof urlOrOptions !== "string" && !(urlOrOptions instanceof URL)
        ? urlOrOptions
        : { url: urlOrOptions },
      rejectUnauthorized: false,
      credential: this.credential,
      body:
        typeof urlOrOptions !== "string" && !(urlOrOptions instanceof URL)
          ? urlOrOptions?.body
          : body,
    });
    return response;
  }

  async getOverlay() {
    const response = await this.request({
      method: "GET",
      url: `http://${this.ip}/cgi-bin/configManager.cgi?action=getConfig&name=VideoWidget`,
      responseType: "text",
      headers: {
        "Content-Type": "application/xml",
      },
    });
    const body = response.body.trim();
    if (!body.startsWith("<")) {
      const config: { [key: string]: string } = {};
      for (const line of body.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const splitIndex = trimmed.indexOf("=");
        if (splitIndex === -1) continue;
        const key = trimmed.substring(0, splitIndex).trim();
        const value = trimmed.substring(splitIndex + 1).trim();
        config[key] = value;
      }
      return { config, text: body };
    } else {
      const json = await xml2js.parseStringPromise(body);
      return { json, xml: body };
    }
  }

  async updateOverlayText(overlayId: string, text: string) {
    // First, enable the custom title if it isn’t already turned on.
    const enableUrl = `http://${this.ip}/cgi-bin/configManager.cgi?action=setConfig&VideoWidget[0].CustomTitle[${overlayId}].EncodeBlend=true&VideoWidget[0].CustomTitle[${overlayId}].PreviewBlend=true`;
    this.console.log(`Enabling overlay ${overlayId}`);
    await this.request({
      method: "GET",
      url: enableUrl,
      responseType: "text",
    });
    // Wait for a short delay before sending the text update.
    await delay(300);
    const textUrl = `http://${this.ip}/cgi-bin/configManager.cgi?action=setConfig&VideoWidget[0].CustomTitle[${overlayId}].Text=${encodeURIComponent(
      text
    )}`;
    this.console.log(`Updating overlay ${overlayId} with text: ${text}`);
    await this.request({
      method: "GET",
      url: textUrl,
      responseType: "text",
    });
  }

  async disableOverlayText(overlayId: string) {
    const disableUrl = `http://${this.ip}/cgi-bin/configManager.cgi?action=setConfig&VideoWidget[0].CustomTitle[${overlayId}].EncodeBlend=false`;
    this.console.log(`Disabling overlay ${overlayId}`);
    await this.request({
      method: "GET",
      url: disableUrl,
      responseType: "text",
    });
    // Optionally wait a little if you need further delay
    await delay(300);
  }
}
