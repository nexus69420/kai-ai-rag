import { MessageSquare, Trash2 } from "lucide-react"
import UploadBox from "./UploadBox"

function Sidebar({
  uploadedPdfs,
  setUploadedPdfs,
  selectedPdf,
  setSelectedPdf,
  chatSessions,
  setChatSessions
}) {

  const deletePdf = (documentId) => {

  setUploadedPdfs((prev) =>
    prev.filter((pdf) => pdf.document_id !== documentId)
  )

  setChatSessions((prev) => {

    const updated = { ...prev }

    delete updated[documentId]

    return updated
  })

  if (selectedPdf === documentId) {

    setSelectedPdf(null)
  }
}

  return (

    <div className="w-72 bg-zinc-950 border-r border-zinc-800 flex flex-col">

      <div className="p-6 border-b border-zinc-800">

        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-white to-zinc-500 bg-clip-text text-transparent">
          KAI
        </h1>

        <p className="text-zinc-500 text-sm mt-1">
          AI PDF Intelligence
        </p>
        <p className="text-xs text-zinc-600 mt-2">
  {uploadedPdfs.length}/5 PDFs Uploaded
</p>

      </div>


      


      <UploadBox
        uploadedPdfs={uploadedPdfs}
        setUploadedPdfs={setUploadedPdfs}
        setSelectedPdf={setSelectedPdf}
      />


      <div className="px-4 py-4 space-y-3 overflow-y-auto">

        {uploadedPdfs.map((pdf) => (

          <div
            key={pdf.document_id}
            onClick={() => setSelectedPdf(

              
              
              pdf.document_id)}
            className={`
              flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition
              ${selectedPdf === pdf.document_id
                ? "bg-zinc-800 border border-zinc-700"
                : "hover:bg-zinc-800/60"
              }
            `}
          >

           <MessageSquare size={18} />

<div className="flex items-center justify-between w-full">

  <span className="text-sm truncate">
    {pdf.filename}
  </span>

  <Trash2
    size={16}
    className="text-zinc-500 hover:text-red-400 transition flex-shrink-0"
    onClick={(e) => {

      e.stopPropagation()

      deletePdf(pdf.document_id)
    }}
  />

</div>

          </div>

        ))}

      </div>

    </div>
  )
}

export default Sidebar