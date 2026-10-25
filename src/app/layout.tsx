import type { Metadata } from "next";
import { El_Messiri, JetBrains_Mono, Vazirmatn } from "next/font/google";
import localFont from "next/font/local";
import { Header } from "@/components/header";
import { cookies } from "next/headers";
import { QueryProvider } from "@/components/query-provider";
import { ThemeScript } from "@/components/theme-script";
import { getSession } from "@/lib/auth";
import { getDatasetVersion } from "@/lib/dataset-version";
import { DEFAULT_THEME, THEME_COOKIE, isTheme } from "@/lib/theme/themes";
import "./globals.css";
import { t } from "@/lib/copy/fa";

// Default theme (kahroba) keeps the original look: Google Vazirmatn, exactly as on fork-main.
const vazirmatn = Vazirmatn({
  subsets: ["arabic", "latin"],
  variable: "--font-vazirmatn",
  display: "swap",
});

// Per-theme fonts, self-hosted (OFL). Each is selected only by its [data-theme] in themes.css.
const vazirLocal = localFont({
  src: [
    { path: "./fonts/Vazirmatn-Medium.woff2", weight: "400 600", style: "normal" },
    { path: "./fonts/Vazirmatn-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-vazir-local",
  display: "swap",
  preload: false,
});

const notoArabic = localFont({
  src: [
    { path: "./fonts/NotoSansArabic-Regular.ttf", weight: "400 600", style: "normal" },
    { path: "./fonts/NotoSansArabic-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-noto-arabic",
  display: "swap",
  preload: false,
});

const readex = localFont({
  src: [
    { path: "./fonts/ReadexPro-Regular.ttf", weight: "400 600", style: "normal" },
    { path: "./fonts/ReadexPro-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-readex",
  display: "swap",
  preload: false,
});

const elMessiri = El_Messiri({
  subsets: ["arabic", "latin"],
  weight: ["500", "600", "700"],
  variable: "--font-el-messiri",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: t.app.name,
    template: t.app.titleTemplate,
  },
  description: t.app.description,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  const cookieTheme = (await cookies()).get(THEME_COOKIE)?.value;
  const theme = isTheme(cookieTheme) ? cookieTheme : DEFAULT_THEME;
  return (
    <html
      lang="fa"
      dir="rtl"
      data-theme={theme}
      suppressHydrationWarning
      className={`${vazirmatn.variable} ${vazirLocal.variable} ${notoArabic.variable} ${readex.variable} ${elMessiri.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="flex min-h-full flex-col">
        <QueryProvider datasetVersion={getDatasetVersion()}>
          <Header session={session} theme={theme} />
          <div id="content" className="flex-1">
            {children}
          </div>
        </QueryProvider>
      </body>
    </html>
  );
}
