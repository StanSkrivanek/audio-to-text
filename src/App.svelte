<script>
  import { onMount } from "svelte";

  let videoPath = "";
  let videoUrl = "";
  let transcript = "";
  let isProcessing = false;
  let errorMessage = "";
  let progressMessage = "Ready";

  // Whisper initialization status
  let whisperStatus = {
    initialized: false,
    checking: true,
    error: null,
  };

  // Add custom paths
  let customPaths = {
    cmake: "",
    make: "",
    python: "",
  };

  let showCustomPaths = false;

  onMount(async () => {
    whisperStatus.checking = true;
    try {
      const status = await window.electronAPI.checkWhisperStatus();
      whisperStatus.initialized = status.initialized;
      whisperStatus.error = status.error || null;
    } catch (error) {
      whisperStatus.error = error.message;
    } finally {
      whisperStatus.checking = false;
    }

    // Listen for Whisper status updates
    window.electronAPI.onWhisperStatus((data) => {
      whisperStatus.initialized = data.initialized;
      whisperStatus.error = data.error || null;
      whisperStatus.checking = false;
      progressMessage = data.message || "Ready";
    });

    // Listen for transcription progress
    window.electronAPI.onTranscriptionProgress((data) => {
      if (data.status === "started") {
        progressMessage = data.message || "Processing...";
      } else if (data.status === "completed") {
        progressMessage = "Transcription complete!";
      } else if (data.status === "error") {
        progressMessage = `Error: ${data.message}`;
      }
    });
  });

  async function selectVideo() {
    try {
      const filePath = await window.electronAPI.selectVideo();
      if (filePath) {
        videoPath = filePath;
        // Use a properly encoded file URL for local videos
        videoUrl = `file://${encodeURIComponent(videoPath).replace(/%3A/g, ":").replace(/%5C/g, "\\").replace(/%2F/g, "/")}`;
        transcript = "";
        errorMessage = "";
      }
    } catch (error) {
      errorMessage = `Error selecting video: ${error.message}`;
    }
  }

  async function generateTranscript() {
    if (!videoPath) {
      errorMessage = "Please select a video file first.";
      return;
    }

    if (!whisperStatus.initialized) {
      errorMessage = "Whisper.cpp is not initialized. Please initialize it first.";
      return;
    }

    isProcessing = true;
    errorMessage = "";
    progressMessage = "Starting transcription...";

    try {
      const result = await window.electronAPI.transcribeVideo(videoPath);

      if (result.error) {
        errorMessage = result.error;
      } else {
        transcript = result.transcript;
        progressMessage = `Transcription complete using ${result.model} model`;
      }
    } catch (error) {
      console.error("Error processing video:", error);
      errorMessage = `Error processing video: ${error.message}`;
    } finally {
      isProcessing = false;
    }
  }

  function saveTranscript() {
    if (!transcript) return;

    const element = document.createElement("a");
    const file = new Blob([transcript], { type: "text/plain" });
    element.href = URL.createObjectURL(file);

    // Extract basename from the path
    const basename = videoPath.split(/[\\/]/).pop();
    const nameWithoutExt = basename.substring(0, basename.lastIndexOf(".")) || basename;

    element.download = `transcript-${nameWithoutExt}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  }

  // Modified skipDependencyChecks to use custom paths
  async function skipDependencyChecks() {
    try {
      errorMessage = "";
      whisperStatus.checking = true;

      const options = {
        skipDependencyCheck: true,
        paths: showCustomPaths ? customPaths : undefined,
      };

      const result = await window.electronAPI.initializeWhisperWithOptions(options);

      whisperStatus.initialized = result.initialized;
      whisperStatus.error = result.error || null;

      if (result.initialized) {
        progressMessage = "Whisper.cpp initialized successfully (skipped dependency checks)";
      } else {
        errorMessage = result.error || "Failed to initialize Whisper.cpp";
      }
    } catch (error) {
      errorMessage = `Error during initialization: ${error.message}`;
    } finally {
      whisperStatus.checking = false;
    }
  }

  function toggleCustomPaths() {
    showCustomPaths = !showCustomPaths;
  }
</script>

<main>
  <h1>Video Transcription App</h1>

  <!-- Whisper Status Section -->
  <div class="status-section">
    <h2>System Status</h2>

    {#if whisperStatus.checking}
      <p>Initializing Whisper.cpp automatically...</p>
      <div class="progress-bar">
        <div class="progress-bar-inner"></div>
      </div>
    {:else if whisperStatus.initialized}
      <p class="success">✓ Whisper.cpp is initialized and ready</p>
    {:else}
      <div class="error-block">
        <p>❌ Whisper.cpp initialization failed</p>
        {#if whisperStatus.error}
          <p class="error">{whisperStatus.error}</p>

          {#if whisperStatus.error.includes("Missing required dependencies")}
            <div class="info-message">
              <p><strong>For Developers:</strong> This app requires build tools because it needs to compile Whisper.cpp from source.</p>
              <p>If you are an end user, please contact the app developer for a pre-built version.</p>
            </div>
          {/if}

          <!-- Add option to use custom paths -->
          <div class="custom-paths">
            <button
              class="path-toggle"
              on:click={toggleCustomPaths}>
              {showCustomPaths ? "Hide Custom Paths" : "Advanced: Specify Tool Paths"}
            </button>

            {#if showCustomPaths}
              <div class="path-inputs">
                <div class="path-input">
                  <label for="cmake-path">CMake Path:</label>
                  <input
                    id="cmake-path"
                    type="text"
                    bind:value={customPaths.cmake}
                    placeholder="/usr/local/bin/cmake" />
                </div>

                <div class="path-input">
                  <label for="make-path">Make Path:</label>
                  <input
                    id="make-path"
                    type="text"
                    bind:value={customPaths.make}
                    placeholder="/usr/bin/make" />
                </div>

                <div class="path-input">
                  <label for="python-path">Python Path:</label>
                  <input
                    id="python-path"
                    type="text"
                    bind:value={customPaths.python}
                    placeholder="/usr/bin/python3" />
                </div>
              </div>
            {/if}
          </div>

          <button
            class="retry-button"
            on:click={skipDependencyChecks}>
            Initialize Without Dependency Checks
          </button>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Video Selection Section -->
  <div class="upload-section">
    <button
      on:click={selectVideo}
      disabled={isProcessing || !whisperStatus.initialized}>
      Select Video File
    </button>

    {#if videoPath}
      <p class="file-info">Selected: {videoPath}</p>
    {/if}

    {#if errorMessage}
      <p class="error">{errorMessage}</p>
    {/if}
  </div>

  <!-- Video Preview Section -->
  {#if videoPath}
    <div class="video-preview">
      <h2>Video Preview</h2>

      <!-- For local file viewing in Electron -->
      <div class="video-container">
        <video
          controls
          width="100%">
          <source src={videoUrl} />
          <track kind="captions" src="captions.vtt" srclang="en" label="English" default />
          Your browser does not support the video tag.
        </video>
      </div>

      <button
        on:click={generateTranscript}
        disabled={isProcessing || !whisperStatus.initialized}
        class="action-button">
        {isProcessing ? "Processing..." : "Generate Transcript"}
      </button>
    </div>
  {/if}

  <!-- Processing Status -->
  {#if isProcessing}
    <div class="processing">
      <h3>Transcription Progress</h3>
      <p>{progressMessage}</p>
      <div class="progress-bar">
        <div class="progress-bar-inner"></div>
      </div>
    </div>
  {/if}

  <!-- Transcript Result -->
  {#if transcript}
    <div class="transcript-section">
      <h2>Transcript</h2>
      <pre>{transcript}</pre>
      <div class="button-group">
        <button
          on:click={saveTranscript}
          class="action-button">Save Transcript</button>
      </div>
    </div>
  {/if}
</main>

<style>
  main {
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
    font-family: sans-serif;
  }

  h1 {
    text-align: center;
    color: #333;
  }

  h2 {
    color: #444;
    border-bottom: 1px solid #eee;
    padding-bottom: 8px;
  }

  .status-section,
  .upload-section,
  .video-preview,
  .transcript-section,
  .processing {
    margin: 20px 0;
    padding: 15px;
    border: 1px solid #ddd;
    border-radius: 5px;
    background-color: #f9f9f9;
  }

  .success {
    color: #4caf50;
    font-weight: bold;
  }

  .error {
    color: #f44336;
  }

  .error-block {
    background-color: #fff8f8;
    padding: 10px;
    border-radius: 4px;
  }

  .file-info {
    font-style: italic;
    word-break: break-all;
    margin: 10px 0;
    padding: 5px;
    background-color: #f0f0f0;
    border-radius: 3px;
  }

  button {
    padding: 8px 16px;
    margin: 10px 0;
    background-color: #4caf50;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.3s;
  }

  button:hover {
    background-color: #45a049;
  }

  button:disabled {
    background-color: #cccccc;
    cursor: not-allowed;
  }

  .action-button {
    background-color: #2196f3;
  }

  .action-button:hover {
    background-color: #0b7dda;
  }

  .retry-button {
    background-color: #ff9800;
  }

  .retry-button:hover {
    background-color: #f57c00;
  }

  pre {
    white-space: pre-wrap;
    background-color: #f5f5f5;
    padding: 15px;
    border-radius: 5px;
    max-height: 400px;
    overflow-y: auto;
    border: 1px solid #ddd;
  }

  .video-container {
    margin: 15px 0;
    background-color: #000;
    border-radius: 5px;
    overflow: hidden;
  }

  .progress-bar {
    width: 100%;
    height: 10px;
    background-color: #e0e0e0;
    border-radius: 5px;
    overflow: hidden;
    margin-top: 10px;
  }

  .progress-bar-inner {
    width: 100%;
    height: 100%;
    background-color: #2196f3;
    border-radius: 5px;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0% {
      opacity: 0.6;
      transform: translateX(-100%);
    }
    100% {
      opacity: 1;
      transform: translateX(100%);
    }
  }

  .button-group {
    display: flex;
    justify-content: space-between;
    margin-top: 10px;
  }

  .path-toggle {
    background-color: #607d8b;
    margin-bottom: 10px;
  }

  .path-toggle:hover {
    background-color: #455a64;
  }

  .path-inputs {
    background-color: #f5f5f5;
    padding: 10px;
    border-radius: 4px;
    margin-bottom: 10px;
  }

  .path-input {
    margin-bottom: 8px;
    display: flex;
    align-items: center;
  }

  .path-input label {
    flex: 0 0 120px;
    font-weight: bold;
  }

  .path-input input {
    flex: 1;
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 4px;
  }

  .info-message {
    background-color: #e3f2fd;
    border-left: 4px solid #2196f3;
    padding: 10px;
    margin: 10px 0;
    line-height: 1.5;
  }
</style>
