import axios from "axios"

function UploadBox() {

  const handleFileUpload = async (e) => {

    const file = e.target.files[0]

    if (!file) return


    const formData = new FormData()

    formData.append("file", file)


    try {

      const response = await axios.post(
        "http://127.0.0.1:8000/upload-pdf",
        formData
      )

      console.log(response.data)

      alert("PDF uploaded successfully 🚀")

    } catch (error) {

      console.log(error)

      alert("Upload failed")
    }
  }


  return (
    <div className="p-4 border-b border-zinc-800">

      <label className="flex flex-col items-center justify-center border border-dashed border-zinc-700 rounded-2xl p-6 cursor-pointer hover:bg-zinc-900 transition">

        <span className="text-sm text-zinc-400 mb-2">
          Upload PDF
        </span>

        <span className="text-xs text-zinc-600">
          Click to upload
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