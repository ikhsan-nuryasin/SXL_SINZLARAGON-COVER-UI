function normalizeHostname(rawValue) {
  let hostname = String(rawValue || "").trim().toLowerCase();
  hostname = hostname.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!hostname) return "";
  if (hostname.length > 253 || !/^[a-z0-9.-]+$/.test(hostname) || hostname.includes("..") || hostname.startsWith(".") || hostname.endsWith(".")) {
    throw new Error("Hostname tidak valid. Contoh: toko.test");
  }
  const labels = hostname.split(".");
  if (labels.some(label => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"))) {
    throw new Error("Hostname tidak valid. Gunakan nama domain lokal seperti toko.test.");
  }
  return hostname;
}

function isAllowedWebUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch { return false; }
}

module.exports = { normalizeHostname, isAllowedWebUrl };
