import { THEME_STORAGE_KEY } from "@/lib/theme/themes";

// Runs before paint: localStorage wins over the cookie if they disagree (e.g. cookie cleared).
export function ThemeScript() {
  const code = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t&&/^[a-z]+$/.test(t))document.documentElement.dataset.theme=t}catch(e){}`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
