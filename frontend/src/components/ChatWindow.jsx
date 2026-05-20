import { useEffect, useRef } from "react"
import ReactMarkdown from "react-markdown"

function ChatWindow({ messages, loading }) {

  const bottomRef = useRef(null)

  useEffect(() => {

    bottomRef.current?.scrollIntoView({
      behavior: "smooth"
    })

  }, [messages, loading])

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

              {message.sources && (

                <div className="mt-6 border-t border-zinc-700 pt-4">

                  <p className="text-xs text-zinc-400 mb-3 uppercase tracking-wider">
                    Sources
                  </p>

                  <div className="space-y-3">

                    {message.sources.map((source, index) => (

                      <div
                        key={index}
                        className="bg-black/40 border border-zinc-800 text-zinc-300 text-xs p-4 rounded-xl leading-relaxed"
                      >

                        {source}

                      </div>

                    ))}

                  </div>

                </div>

              )}

            </div>

          </div>

        ))}


        {loading && (

          <div className="max-w-3xl px-5 py-4 rounded-3xl shadow-lg bg-zinc-900 border border-zinc-800">

            <div className="flex items-center gap-2 text-zinc-400">

              <div className="w-2 h-2 rounded-full bg-white animate-bounce" />

              <div className="w-2 h-2 rounded-full bg-white animate-bounce delay-100" />

              <div className="w-2 h-2 rounded-full bg-white animate-bounce delay-200" />

              <span className="ml-2 text-sm">
                Thinking...
              </span>

            </div>

          </div>

        )}


        <div ref={bottomRef} />

      </div>

    </div>

  )
}

export default ChatWindow