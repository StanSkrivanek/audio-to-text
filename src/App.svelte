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

  // Helper function to determine if it's a video file
  function isVideoFile(filePath) {
    if (!filePath) return false;
    const ext = filePath.toLowerCase().split(".").pop();
    return ["mp4", "webm", "mov", "avi", "mkv"].includes(ext);
  }

  async function selectVideo() {
    try {
      const filePath = await window.electronAPI.selectVideo();
      if (filePath) {
        videoPath = filePath;
        // Use a properly encoded file URL for local media
        videoUrl = `file://${encodeURIComponent(videoPath).replace(/%3A/g, ":").replace(/%5C/g, "\\").replace(/%2F/g, "/")}`;
        transcript = "";
        errorMessage = "";
      }
    } catch (error) {
      errorMessage = `Error selecting file: ${error.message}`;
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

  // Audio player state
  let audioPlayer;
  let isPlaying = false;
  let currentTime = 0;
  let duration = 0;
  let volume = 0.75;
  let showVolumeControl = false;

  function togglePlay() {
    if (audioPlayer) {
      if (isPlaying) {
        audioPlayer.pause();
      } else {
        audioPlayer.play();
      }
      isPlaying = !isPlaying;
    }
  }

  function updateTime() {
    if (audioPlayer) {
      currentTime = audioPlayer.currentTime;
      duration = audioPlayer.duration || 0;
    }
  }

  function handleTimeChange(e) {
    if (audioPlayer) {
      audioPlayer.currentTime = e.target.value;
      currentTime = audioPlayer.currentTime;
    }
  }

  function handleVolumeChange(e) {
    if (audioPlayer) {
      volume = e.target.value;
      audioPlayer.volume = volume;
    }
  }

  function formatTime(timeInSeconds) {
    if (isNaN(timeInSeconds)) return "0:00";

    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60)
      .toString()
      .padStart(2, "0");
    return `${minutes}:${seconds}`;
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
      Select Media File
    </button>

    {#if videoPath}
      <p class="file-info">Selected: {videoPath}</p>
    {/if}

    {#if errorMessage}
      <p class="error">{errorMessage}</p>
    {/if}
  </div>

  <!-- Media Preview Section -->
  {#if videoPath}
    <div class="video-preview">
      <h2>Media Preview</h2>

      <!-- For local file viewing in Electron -->
      <div class="video-container">
        {#if isVideoFile(videoPath)}
          <video
            controls
            width="100%">
            <source src={videoUrl} />
            <track
              kind="captions"
              src="captions.vtt"
              srclang="en"
              label="English" />
            Your browser does not support the video tag.
          </video>
        {:else}
          <!-- Modern Audio Player -->
          <div class="modern-audio-player">
            <audio
              bind:this={audioPlayer}
              src={videoUrl}
              on:timeupdate={updateTime}
              on:play={() => (isPlaying = true)}
              on:pause={() => (isPlaying = false)}
              on:ended={() => (isPlaying = false)}
              preload="metadata">
            </audio>

            <div class="audio-artwork">
              <div class="audio-icon">
                <svg
                  viewBox="0 0 24 24"
                  width="32"
                  height="32">
                  <path
                    fill="currentColor"
                    d="M12,2C6.48,2 2,6.48 2,12C2,17.52 6.48,22 12,22C17.52,22 22,17.52 22,12C22,6.48 17.52,2 12,2M12,16.5C9.5,16.5 7.5,14.5 7.5,12C7.5,9.5 9.5,7.5 12,7.5C14.5,7.5 16.5,9.5 16.5,12C16.5,14.5 14.5,16.5 12,16.5" />
                </svg>
              </div>
              <div class="audio-visualizer">
                {#each Array(20) as _, i}
                  <div
                    class="visualizer-bar"
                    style="height: {isPlaying ? 30 + Math.abs(Math.sin((i + 1 + Date.now() / 500) * 0.5)) * 70 : 20 + Math.abs(Math.sin(i * 0.8)) * 30}%;
                              opacity: {isPlaying ? 0.7 + Math.sin(i * 0.5) * 0.3 : 0.5};">
                  </div>
                {/each}
              </div>
              <div class="audio-details">
                <span class="audio-filename">{videoPath.split(/[\\/]/).pop()}</span>
              </div>
            </div>

            <div class="audio-timeline">
              <span class="time-display current">{formatTime(currentTime)}</span>
              <div class="progress-bar-container">
                <input
                  type="range"
                  min="0"
                  max={duration || 0}
                  value={currentTime}
                  class="timeline-slider"
                  on:input={handleTimeChange} />
                <div class="progress-track">
                  <div
                    class="progress-fill"
                    style="width: {(currentTime / (duration || 1)) * 100}%">
                  </div>
                </div>
              </div>
              <span class="time-display duration">{formatTime(duration)}</span>
            </div>

            <div class="audio-controls">
              <button
                class="control-btn volume-btn"
                on:click={() => (showVolumeControl = !showVolumeControl)}>
                {#if volume > 0.5}
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    ><path
                      fill="currentColor"
                      d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z" /></svg>
                {:else if volume > 0}
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    ><path
                      fill="currentColor"
                      d="M5,9V15H9L14,20V4L9,9M18.5,12C18.5,10.23 17.5,8.71 16,7.97V16C17.5,15.29 18.5,13.76 18.5,12Z" /></svg>
                {:else}
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    ><path
                      fill="currentColor"
                      d="M12,4L9.91,6.09L12,8.18M4.27,3L3,4.27L7.73,9H3V15H7L12,20V13.27L16.25,17.53C15.58,18.04 14.83,18.46 14,18.7V20.77C15.38,20.45 16.63,19.82 17.68,18.96L19.73,21L21,19.73L12,10.73M19,12C19,12.94 18.8,13.82 18.46,14.64L19.97,16.15C20.62,14.91 21,13.5 21,12C21,7.72 18,4.14 14,3.23V5.29C16.89,6.15 19,8.83 19,12M16.5,12C16.5,10.23 15.5,8.71 14,7.97V10.18L16.45,12.63C16.5,12.43 16.5,12.21 16.5,12Z" /></svg>
                {/if}
              </button>

              <!-- Volume Slider Container -->
              {#if showVolumeControl}
                <div
                  class="volume-slider-container"
                  on:mouseleave={() => (showVolumeControl = false)}>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={volume}
                    class="volume-slider"
                    on:input={handleVolumeChange} />
                </div>
              {/if}

              <button
                class="control-btn play-btn"
                on:click={togglePlay}>
                {#if isPlaying}
                  <svg
                    viewBox="0 0 24 24"
                    width="32"
                    height="32"
                    ><path
                      fill="currentColor"
                      d="M14,19H18V5H14M6,19H10V5H6V19Z" /></svg>
                {:else}
                  <svg
                    viewBox="0 0 24 24"
                    width="32"
                    height="32"
                    ><path
                      fill="currentColor"
                      d="M8,5.14V19.14L19,12.14L8,5.14Z" /></svg>
                {/if}
              </button>
            </div>
          </div>
        {/if}
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
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
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

  /* Modern Audio Player */
  .modern-audio-player {
    background: linear-gradient(135deg, #2b3035 0%, #1a1f24 100%);
    border-radius: 16px;
    overflow: hidden;
    color: #ffffff;
    padding: 0;
    position: relative;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
  }

  .audio-artwork {
    position: relative;
    height: 200px;
    background: linear-gradient(45deg, #1a1a2e, #16213e);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: 12px 12px 0 0;
  }

  .audio-icon {
    position: absolute;
    z-index: 2;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 50%;
    padding: 15px;
    color: #fff;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
  }

  .audio-visualizer {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 120px;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: 4px;
    padding: 0 40px 30px;
  }

  .visualizer-bar {
    flex: 1;
    max-width: 6px;
    background: linear-gradient(to top, rgba(59, 130, 246, 0.8), rgba(147, 197, 253, 0.4));
    border-radius: 4px;
    transition: height 0.2s ease;
  }

  .audio-details {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 10px 15px;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.6), transparent);
  }

  .audio-filename {
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
    max-width: 90%;
    opacity: 0.8;
  }

  .audio-timeline {
    display: flex;
    align-items: center;
    padding: 15px 20px 5px;
    gap: 10px;
  }

  .progress-bar-container {
    position: relative;
    flex: 1;
    height: 24px;
    display: flex;
    align-items: center;
  }

  .timeline-slider {
    position: absolute;
    width: 100%;
    height: 24px;
    opacity: 0;
    cursor: pointer;
    margin: 0;
    z-index: 3;
  }

  .progress-track {
    position: absolute;
    left: 0;
    right: 0;
    height: 6px;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
    overflow: hidden;
  }

  .progress-fill {
    position: absolute;
    height: 100%;
    background: linear-gradient(to right, #3b82f6, #93c5fd);
    border-radius: 3px;
    transition: width 0.1s linear;
  }

  .time-display {
    font-size: 12px;
    width: 36px;
    text-align: center;
    opacity: 0.8;
    font-variant-numeric: tabular-nums;
  }

  .audio-controls {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 10px 20px 20px;
    position: relative;
  }

  .control-btn {
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px;
    border-radius: 50%;
    transition: all 0.2s ease;
    margin: 0 5px;
    position: relative;
  }

  .play-btn {
    background: rgba(255, 255, 255, 0.1);
    width: 60px;
    height: 60px;
    transform: scale(1);
  }

  .play-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    transform: scale(1.05);
  }

  .volume-btn {
    background: rgba(255, 255, 255, 0.05);
    position: absolute;
    left: 20px;
  }

  .volume-slider-container {
    position: absolute;
    bottom: 60px;
    left: 20px;
    background: rgba(0, 0, 0, 0.7);
    padding: 12px 10px;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    z-index: 4;
    width: 100px;
    height: 30px;
  }

  .volume-slider {
    width: 80px; /* Wider slider */
    height: 8px; /* Thinner height */
    appearance: none;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
    outline: none;
    /* Remove the rotation that was causing issues */
    margin: 0;
    cursor: pointer;
  }

  .volume-slider::-webkit-slider-thumb {
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #3b82f6;
    cursor: pointer;
  }

  /* Add Firefox-specific slider thumb */
  .volume-slider::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border: none;
    border-radius: 50%;
    background: #3b82f6;
    cursor: pointer;
  }

  /* Add standard slider thumb styles */
  .volume-slider::-ms-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #3b82f6;
    cursor: pointer;
    border: none;
  }
</style>
