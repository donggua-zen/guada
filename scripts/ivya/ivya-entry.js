import { Ivya } from "ivya";

const ivya = Ivya.create({
  browser: "chromium",
  testIdAttribute: "data-testid",
});

globalThis.__guadaIvya = {
  version: "1.8.2",
  ivya,
};
