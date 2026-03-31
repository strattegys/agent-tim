import type { MetadataRoute } from "next";
import {
  getAppBrandTitle,
  getAppleWebAppShortName,
  getAppHeadline,
  getLocalRuntimeLabel,
  getPwaManifestIconPath,
} from "@/lib/app-brand";

export default function manifest(): MetadataRoute.Manifest {
  const icon = getPwaManifestIconPath();
  const localDev = getLocalRuntimeLabel() === "LOCALDEV";

  return {
    name: getAppBrandTitle(),
    short_name: getAppleWebAppShortName(),
    description: getAppHeadline(),
    start_url: "/",
    display: "standalone",
    background_color: "#0a0f18",
    theme_color: localDev ? "#c2410c" : "#0e1621",
    orientation: "any",
    icons: [
      {
        src: icon,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: icon,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    share_target: {
      action: "/share-intake",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
      },
    },
  };
}
