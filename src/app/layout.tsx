import type { Metadata } from "next";
import { El_Messiri, JetBrains_Mono, Vazirmatn } from "next/font/google";
import { Header } from "@/components/header";
import { getSession } from "@/lib/auth";
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
  return (
    <html
      lang="fa"
      dir="rtl"
      className={`${vazirmatn.variable} ${elMessiri.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Header session={session} />
        <div id="content" className="flex-1">
          {children}
        </div>
      </body>
    </html>
  );
}
