const releaseUrl = "https://github.com/ByronAndrade/demiplane-dice-room/releases/latest";
const supportEmail = "foxbyron@gmail.com";

for (const link of document.querySelectorAll<HTMLAnchorElement>("a[data-external-link]")) {
  link.target = "_blank";
  link.rel = "noreferrer";
}

const releaseLink = document.querySelector<HTMLAnchorElement>("[data-latest-release]");
if (releaseLink) {
  releaseLink.href = releaseUrl;
}

const supportLink = document.querySelector<HTMLAnchorElement>("[data-support-email]");
if (supportLink) {
  supportLink.href = `mailto:${supportEmail}`;
  supportLink.textContent = supportEmail;
}
