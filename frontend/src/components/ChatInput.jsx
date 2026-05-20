import { useState } from "react"
import { SendHorizonal } from "lucide-react"

function ChatInput({ sendMessage }) {

  const [input, setInput] = useState("")


  const handleSend = () => {

    if (!input.trim()) return

    sendMessage(input)

    setInput("")
  }


  const handleKeyDown = (e) => {

    if (e.key === "Enter") {
      handleSend()
    }
  }


  return (
    <div className="p-6 border-t border-zinc-800 bg-black/50 backdrop-blur-xl">

      <div className="max-w-4xl mx-auto flex items-center gap-4 bg-zinc-900 border border-zinc-700 rounded-2xl px-4 py-3 shadow-2xl">

        <input
          type="text"
          placeholder="Ask anything from your PDFs..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent outline-none text-white placeholder:text-zinc-500"
        />


        <button
          onClick={handleSend}
          className="bg-white text-black p-3 rounded-xl hover:bg-zinc-200 transition-all"
        >

          <SendHorizonal size={18} />

        </button>

      </div>

    </div>
  )
}

export default ChatInput