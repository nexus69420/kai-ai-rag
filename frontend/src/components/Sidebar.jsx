import { Plus, MessageSquare } from "lucide-react"
import UploadBox from "./UploadBox"

function Sidebar() {
  return (
    <div className="w-72 bg-zinc-950 border-r border-zinc-800 flex flex-col">

      <div className="p-6 border-b border-zinc-800">

        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-white to-zinc-500 bg-clip-text text-transparent">
          Nexus AI
        </h1>

        <p className="text-zinc-500 text-sm mt-1">
          AI PDF Intelligence
        </p>

      </div>


      <div className="p-4">

        <button className="w-full flex items-center justify-center gap-2 bg-white text-black py-3 rounded-xl font-medium hover:bg-zinc-200 transition-all">

          <Plus size={18} />

          New Chat

        </button>

      </div>

      <UploadBox />
      

      


      <div className="px-3 space-y-2">

        <div className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-zinc-900 cursor-pointer transition">

          <MessageSquare size={18} />

          <span className="text-sm">
            School Registration PDF
          </span>

        </div>

      </div>

    </div>
  )
}

export default Sidebar