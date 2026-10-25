import type { Metadata } from "next";
import { El_Messiri, JetBrains_Mono, Vazirmatn } from "next/font/google";
import { Header } from "@/components/header";
import { cookies } from "next/headers";
import { ThemeScript } from "@/components/theme-script";
import { getSession } from "@/lib/auth";
import { DEFAULT_THEME, THEME_COOKIE, isTheme } from "@/lib/theme/themes";
import "./globals.css";

const vazirmatn = Vazirmatn({
  subsets: ["arabic", "latin"],
  variable: "--font-vazirmatn",
  display: "swap",
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
    default: "رأی دامنه",
    template: "%s · رأی دامنه",
  },
  description: "به دامنه‌ها، دور به دور، رأی بدهید.",
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
      className={`${vazirmatn.variable} ${elMessiri.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="flex min-h-full flex-col">
        <Header session={session} theme={theme} />
        <div id="content" className="flex-1">
          {children}
        </div>
      </body>
    </html>
  );
}
