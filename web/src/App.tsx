import { useEffect } from "react";
import { useStore } from "./state/store";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { FileBrowser } from "./components/FileBrowser";
import { FileViewer } from "./components/FileViewer";
import { UploadDropzone } from "./components/UploadDropzone";
import { CortexView } from "./components/CortexView";
import { useCortex } from "./state/cortex";

export default function App() {
  const init = useStore((s) => s.init);
  const view = useCortex((s) => s.view);

  useEffect(() => {
    init();
    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, [init]);

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />
      {view === "cortex" ? (
        <CortexView />
      ) : (
        <>
          <ChatView />
          <FileBrowser />
        </>
      )}
      <FileViewer />
      <UploadDropzone />
    </div>
  );
}
