import { useState } from "react"
import axios from "axios"

import Sidebar from "./components/Sidebar"
import Navbar from "./components/Navbar"
import ChatWindow from "./components/ChatWindow"
import ChatInput from "./components/ChatInput"

function App() {

  const [chatSessions, setChatSessions] = useState({})

  const [uploadedPdfs, setUploadedPdfs] = useState([])

  const [selectedPdf, setSelectedPdf] = useState(null)

  const [loading, setLoading] = useState(false)

  const activeMessages = selectedPdf
    ? chatSessions[selectedPdf] || []
    : []


const sendMessage = async (text) => {

  if (!selectedPdf) {

    alert("Please upload and select a PDF first.")

    return
  }

  const userMessage = {
    sender: "user",
    text: text
  }

  setChatSessions((prev) => ({

    ...prev,

    [selectedPdf]: [

      ...(prev[selectedPdf] || []),

      userMessage
      

    ]

  }))

  try {

    setLoading(true)

    const response = await axios.post(
      "http://127.0.0.1:8000/rag-chat",
      {
        message: text,
        document_id: selectedPdf
      }
    )

    const aiMessage = {
      sender: "ai",
      text: response.data.answer,
      sources: response.data.retrieved_chunks
    }

    setChatSessions((prev) => ({

      ...prev,

      [selectedPdf]: [

        ...(prev[selectedPdf] || []),

        aiMessage

      ]

    }))

    setLoading(false)

    

  } catch (error) {

    console.log(error)

    const errorMessage = {
      sender: "ai",
      text: "Something went wrong."
    }

    setLoading(false)

    setChatSessions((prev) => ({

      ...prev,

      [selectedPdf]: [

        ...(prev[selectedPdf] || []),

        errorMessage

      ]

    }))

    
  }
}


  return (
    <div className="h-screen bg-gradient-to-br from-black via-zinc-950 to-zinc-900 text-white flex">

      <Sidebar
        uploadedPdfs={uploadedPdfs}
        setUploadedPdfs={setUploadedPdfs}
        selectedPdf={selectedPdf}
        setSelectedPdf={setSelectedPdf}
        chatSessions={chatSessions}
        setChatSessions={setChatSessions}
      />

      <div className="flex-1 flex flex-col">

        <Navbar />

        <ChatWindow
          messages={activeMessages}
          loading={loading}
        />

        <ChatInput sendMessage={sendMessage} />

      </div>

    </div>
  )
}

export default App