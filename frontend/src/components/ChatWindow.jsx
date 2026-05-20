import ReactMarkdown from "react-markdown"

function ChatWindow({ messages }) {

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">

      <div className="max-w-4xl mx-auto space-y-6">

        {messages.map((message, index) => (

          <div
            key={index}
            className={`
              max-w-3xl px-5 py-4 rounded-3xl shadow-lg
              ${message.sender === "user"
                ? "bg-white text-black ml-auto"
                : "bg-zinc-900 border border-zinc-800"
              }
            `}
          >

            <div className="prose prose-invert max-w-none">

              <ReactMarkdown>
                {message.text}
              </ReactMarkdown>

            </div>

          </div>

        ))}

      </div>

    </div>
  )
}

export default ChatWindow