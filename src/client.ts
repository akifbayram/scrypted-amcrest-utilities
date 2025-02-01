import {
    AuthFetchCredentialState,
    HttpFetchOptions,
    authHttpFetch,
  } from "@scrypted/common/src/http-auth-fetch";
  import xml2js from "xml2js";
  import { Readable } from "stream";
  import { VideoWidgetRoot } from "./types";
  
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
        // If the response does not start with "<", assume it’s plain text config
        if (!body.startsWith("<")) {
          // Parse the plain text response: each non-empty line should be key=value.
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
          // Return the parsed config in a property (for example, 'config')
          return { config, text: body };
        } else {
          // Fallback: assume XML and parse normally.
          const json = await xml2js.parseStringPromise(body);
          return { json, xml: body };
        }
      }            
  
    async updateOverlayText(overlayId: string, text: string) {
      // First, enable the custom title if it isn’t already turned on.
      const enableUrl = `http://${this.ip}/cgi-bin/configManager.cgi?action=setConfig&VideoWidget[0].CustomTitle[${overlayId}].EncodeBlend=true&VideoWidget[0].CustomTitle[${overlayId}].PreviewBlend=true`;
      await this.request({
        method: "GET",
        url: enableUrl,
        responseType: "text",
      });
      // Now, update the text for the custom title.
      const textUrl = `http://${this.ip}/cgi-bin/configManager.cgi?action=setConfig&VideoWidget[0].CustomTitle[${overlayId}].Text=${encodeURIComponent(
        text
      )}`;
      await this.request({
        method: "GET",
        url: textUrl,
        responseType: "text",
      });
    }
  }
  