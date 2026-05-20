import { useState } from "react"
import axios from "axios"

import Sidebar from "./components/Sidebar"
import Navbar from "./components/Navbar"
import ChatWindow from "./components/ChatWindow"
import ChatInput from "./components/ChatInput"

function App() {

  const [messages, setMessages] = useState([
    {
      sender: "ai",
      text: "Hello 👋"
    }
  ])


const sendMessage = async (text) => {

  const userMessage = {
    sender: "user",
    text: text
  }

  setMessages((prev) => [...prev, userMessage])

  try {

    const response = await axios.post(
      "http://127.0.0.1:8000/rag-chat",
      {
        message: text
      }
    )

    const aiMessage = {
      sender: "ai",
      text: response.data.answer
    }

    setMessages((prev) => [...prev, aiMessage])

  } catch (error) {

    console.log(error)

    const errorMessage = {
      sender: "ai",
      text: "Something went wrong."
    }

    setMessages((prev) => [...prev, errorMessage])
  }
}


  return (
    <div className="h-screen bg-gradient-to-br from-black via-zinc-950 to-zinc-900 text-white flex">

      <Sidebar />

      <div className="flex-1 flex flex-col">

        <Navbar />

        <ChatWindow messages={messages} />

        <ChatInput sendMessage={sendMessage} />

      </div>

    </div>
  )
}

export default App