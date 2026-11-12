import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next, Atkinson_Hyperlegible_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./components/ThemeProvider";

// Both families are variable fonts designed for legibility; see globals.css for the theme tokens
const interfaceFont = Atkinson_Hyperlegible_Next({
  variable: "--font-ui",
  subsets: ["latin"],
});

const editorFont = Atkinson_Hyperlegible_Mono({
  variable: "--font-editor",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Verbalize",
  description: "A writing assistant for technical writers, with Vale linting",
};

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The font variables live on <html>: Tailwind's default font-family is set there and
    // cannot see variables declared on a descendant such as <body>.
    <html
      lang="en"
      className={`${interfaceFont.variable} ${editorFont.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
