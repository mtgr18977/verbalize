import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { Atkinson_Hyperlegible_Next, Atkinson_Hyperlegible_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./components/ThemeProvider";
import { I18nProvider } from "@/i18n/provider";
import { LOCALE_COOKIE, resolveLocale } from "@/i18n/locale";
import type { Locale } from "@/i18n/locale";
import { createTranslator } from "@/i18n/translate";

// Both families are variable fonts designed for legibility; see globals.css for the theme tokens
const interfaceFont = Atkinson_Hyperlegible_Next({
  variable: "--font-ui",
  subsets: ["latin"],
});

const editorFont = Atkinson_Hyperlegible_Mono({
  variable: "--font-editor",
  subsets: ["latin"],
});

/**
 * The language is decided per request: an explicit choice (cookie) wins over the browser's
 * Accept-Language. Reading request data makes the page dynamic, which is what lets the very first
 * paint already be in the right language instead of switching after hydration.
 */
async function getLocale(): Promise<Locale> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  return resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value, headerList.get("accept-language"));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = createTranslator(await getLocale());
  return {
    title: "Verbalize",
    description: t("meta.description"),
  };
}

// viewportFit "cover" lets the bottom tab bar respect the phone's safe area (home indicator);
// the browser chrome takes the color of the header.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAFBFA" },
    { media: "(prefers-color-scheme: dark)", color: "#151D19" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();

  return (
    // The font variables live on <html>: Tailwind's default font-family is set there and
    // cannot see variables declared on a descendant such as <body>.
    <html
      lang={locale}
      className={`${interfaceFont.variable} ${editorFont.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <I18nProvider initialLocale={locale}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            {children}
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
