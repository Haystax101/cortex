import { useEffect } from "react";
import { useStore } from "./state/store";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { FileBrowser } from "./components/FileBrowser";
import { FileViewer } from "./components/FileViewer";
import { UploadDropzone } from "./components/UploadDropzone";

export default function App() {
  const init = useStore((s) => s.init);

  useEffect(() => {
    init();
    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, [init]);

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />
      <ChatView />
      <FileBrowser />
      <FileViewer />
      <UploadDropzone />
    </div>
  );
}
