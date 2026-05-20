import { useState } from "react"
import axios from "axios"

function UploadBox({
  uploadedPdfs,
  setUploadedPdfs,
  setSelectedPdf
}) {

  const [dragActive, setDragActive] = useState(false)

  const uploadPdf = async (file) => {

    if (!file) return

    if (uploadedPdfs.length >= 5) {

      alert("Maximum 5 PDFs allowed.")

      return
    }

    const formData = new FormData()

    formData.append("file", file)

    try {

      const response = await axios.post(
        "http://127.0.0.1:8000/upload-pdf",
        formData
      )

      console.log(response.data)

      const newPdf = {
        filename: response.data.filename,
        document_id: response.data.document_id
      }

      setUploadedPdfs((prev) => [...prev, newPdf])

      setSelectedPdf(response.data.document_id)

      alert("PDF uploaded successfully 🚀")

    } catch (error) {

      console.log(error)

      alert("Upload failed")
    }
  }


  const handleFileUpload = (e) => {

    const file = e.target.files[0]

    if (file) {

      uploadPdf(file)
    }
  }


  const handleDragOver = (e) => {

    e.preventDefault()

    setDragActive(true)
  }


  const handleDragLeave = () => {

    setDragActive(false)
  }


  const handleDrop = (e) => {

    e.preventDefault()

    setDragActive(false)

    const file = e.dataTransfer.files[0]

    if (file) {

      uploadPdf(file)
    }
  }


  return (

    <div className="p-4 border-b border-zinc-800">

      <label
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          flex flex-col items-center justify-center
          border-2 border-dashed rounded-2xl p-6
          cursor-pointer transition-all duration-300
          ${dragActive
            ? "border-white bg-zinc-900 scale-[1.02]"
            : "border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900/50"
          }
        `}
      >

        <span className="text-sm text-zinc-300 mb-2 font-medium">
          Upload PDF
        </span>

        <span className="text-xs text-zinc-500 text-center">
          Drag & drop PDF here
        </span>

        <span className="text-xs text-zinc-600 mt-1">
          or click to browse
        </span>

        <input
          type="file"
          accept=".pdf"
          onChange={handleFileUpload}
          className="hidden"
        />

      </label>

    </div>
  )
}

export default UploadBox