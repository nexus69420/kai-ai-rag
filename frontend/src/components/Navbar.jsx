function Navbar() {
  return (
    <div className="h-16 border-b border-zinc-800 bg-black/60 backdrop-blur-xl flex items-center justify-between px-6">

      <div>

        <h2 className="text-lg font-semibold">
          AI PDF Assistant
        </h2>

        <p className="text-xs text-zinc-500">
          Retrieval Augmented Generation
        </p>

      </div>


      <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />

    </div>
  )
}

export default Navbar