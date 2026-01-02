import './style.css'

interface LetterParticle {
  char: string
  targetAngle: number // Target angle on circle
  currentAngle: number // Current angle (smoothly follows)
  radius: number // Distance from center
  opacity: number
  x: number // Current x position
  y: number // Current y position
  targetX: number // Target x position
  targetY: number // Target y position
  velocityX: number // Velocity for smooth movement
  velocityY: number
  visible: boolean // Whether this letter should be visible
  baseRadius: number // Base radius for floating effect
}

interface HaikuLine {
  text: string
  displayedText: string // Text currently displayed (for letter-by-letter effect)
  particles: LetterParticle[] // Array of letter particles
  baseAngle: number // Base angle position on circle
  streaming: boolean // Whether this line is currently streaming
}

class ZenHaikuGenerator {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private currentHaiku: string[] = []
  private haikuLines: HaikuLine[] = []
  private generationInterval: number = 20000 // 20 seconds
  private haikuGenerationTimer: number | null = null // Timer for auto-regenerating haiku
  private ensoSpeedMultiplier: number = 1.5 // Speed multiplier for enso animation (slower)
  private frameRate: number = 60 // Assuming ~60fps
  private isGenerating: boolean = false
  private fadeInSpeed: number = 0.02 // Fade in speed
  private fadeOutSpeed: number = 0.015 // Fade out speed
  private floatOffset: number = 0
  private isFadingOut: boolean = false
  private ollamaBaseUrl: string = 'http://localhost:11434'
  private model: string = 'llama3.2'
  private ollamaError: string | null = null // Store error message if Ollama is not available
  // Removed animationId - not needed since we use continuousDraw loop
  private animationStarted: boolean = false
  private showHomePage: boolean = true // Show home page initially
  private ensoProgress: number = 0
  private ensoOpacity: number = 0.25 // Increased opacity for more presence
  private ensoRadius: number = 0
  private ensoCenterX: number = 0
  private ensoCenterY: number = 0
  private ensoStartAngle: number = 0 // Starting angle for each cycle
  private ensoStartAngles: number[] = [] // Multiple starting angles for multiple enso circles
  private ensoDirections: number[] = [] // Direction for each circle: 1 for counter-clockwise, -1 for clockwise
  private numEnsoCircles: number = 3 // Number of simultaneous enso circles
  // Calculate enso speed to complete one cycle in the same time as haiku display
  // generationInterval (ms) / frameRate (fps) = frames per cycle
  // 1.0 progress / frames per cycle = speed per frame
  private getEnsoSpeed(): number {
    const framesPerCycle = (this.generationInterval / 1000) * this.frameRate
    return (1.0 / framesPerCycle) * this.ensoSpeedMultiplier
  }
  private englishFont: string = 'Arial, Helvetica, sans-serif' // Simpler font for English haiku

  constructor() {
    const app = document.getElementById('app')
    if (!app) {
      throw new Error('App element not found')
    }

    // Create canvas
    this.canvas = document.createElement('canvas')
    this.canvas.width = window.innerWidth
    this.canvas.height = window.innerHeight
    this.canvas.style.display = 'block'
    app.appendChild(this.canvas)

    const ctx = this.canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Could not get canvas context')
    }
    this.ctx = ctx

    // Handle resize
    window.addEventListener('resize', () => this.handleResize())

    // Initialize enso position
    this.ensoCenterX = this.canvas.width / 2
    this.ensoCenterY = this.canvas.height / 2
    this.ensoRadius = Math.min(this.canvas.width, this.canvas.height) * 0.35
    
    // Initialize multiple starting angles and directions for multiple enso circles
    this.ensoStartAngles = []
    this.ensoDirections = []
    for (let i = 0; i < this.numEnsoCircles; i++) {
      this.ensoStartAngles.push(Math.random() * Math.PI * 2)
      // Randomly choose clockwise (-1) or counter-clockwise (1)
      this.ensoDirections.push(Math.random() < 0.5 ? -1 : 1)
    }

    // Start with empty haiku - only show AI-generated text
    this.currentHaiku = ['', '', '']
    this.initializeHaikuLines()

    // Initialize enso animation with random starting point
    this.ensoProgress = 0
    this.ensoStartAngle = Math.random() * Math.PI * 2

    // Load fonts
    this.loadFonts()

    // Draw initial frame to ensure canvas is rendered
    this.draw()
    
    // Start a continuous draw loop that always runs
    // This ensures text is always visible, even when animation hasn't started
    const continuousDraw = () => {
      this.draw()
      requestAnimationFrame(continuousDraw)
    }
    requestAnimationFrame(continuousDraw)
    
    // Don't start animation automatically - wait for spacebar
    // Set up spacebar listener to start everything
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Space') {
        event.preventDefault() // Prevent page scroll
        
        // Hide home page on first spacebar press
        if (this.showHomePage) {
          this.showHomePage = false
        }
        
        // Start animation if not already started
        if (!this.animationStarted) {
          this.animationStarted = true
          this.animate()
        }
        
        // Generate haiku if not already generating (reset animation on first press)
        if (!this.isGenerating) {
          this.generateHaiku(true) // Reset animation on spacebar press
          
          // Set up interval to regenerate haiku every 20 seconds and reset animation
          if (this.haikuGenerationTimer === null) {
            this.haikuGenerationTimer = window.setInterval(() => {
              if (!this.isGenerating) {
                // Start fade out before generating new haiku
                this.isFadingOut = true
                // Wait for fade out, then generate new haiku
                setTimeout(() => {
                  this.generateHaiku(true) // Reset animation when text regenerates
                }, 2000) // 2 second fade out duration
              }
            }, this.generationInterval)
          }
        }
      }
    })
  }

  private loadFonts() {
    // Check if fonts are loaded
    if (document.fonts && typeof document.fonts.check === 'function') {
      document.fonts.ready.then(() => {
        console.log('Fonts loaded')
        // Force a redraw after fonts are loaded
        this.draw()
      })
    } else {
      // Fallback: wait a bit for fonts to load
      setTimeout(() => {
        // Force a redraw after fonts are loaded
        this.draw()
      }, 1000)
    }
  }

  private handleResize() {
    this.canvas.width = window.innerWidth
    this.canvas.height = window.innerHeight
    // Update enso position and size
    this.ensoCenterX = this.canvas.width / 2
    this.ensoCenterY = this.canvas.height / 2
    this.ensoRadius = Math.min(this.canvas.width, this.canvas.height) * 0.35
    if (this.currentHaiku.length > 0) {
      this.initializeHaikuLines()
    }
  }

  private forceRedraw() {
    // Force a fake redraw by temporarily changing canvas dimensions
    // This triggers the browser to repaint the canvas
    const originalWidth = this.canvas.width
    
    // Temporarily resize by 1 pixel to force redraw
    this.canvas.width = originalWidth + 1
    this.canvas.width = originalWidth
    
    // Also trigger multiple draws
    requestAnimationFrame(() => {
      this.draw()
      requestAnimationFrame(() => {
        this.draw()
      })
    })
  }

  private animate() {
    // Animation loop - but we also have continuousDraw running
    // So this mainly updates animation state
    requestAnimationFrame(() => this.animate())
  }

  private draw() {
    // Ensure canvas dimensions are correct (fixes rendering issues)
    if (this.canvas.width !== window.innerWidth || this.canvas.height !== window.innerHeight) {
      this.canvas.width = window.innerWidth
      this.canvas.height = window.innerHeight
      this.ensoCenterX = this.canvas.width / 2
      this.ensoCenterY = this.canvas.height / 2
      this.ensoRadius = Math.min(this.canvas.width, this.canvas.height) * 0.35
    }
    
    // Clear canvas with white background
    this.ctx.fillStyle = '#ffffff'
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    
    // Ensure context is properly set up
    this.ctx.globalCompositeOperation = 'source-over'
    this.ctx.globalAlpha = 1.0

    // Only update animation if it's started
    if (this.animationStarted) {
      // Update animation
      this.floatOffset += 0.01
      // More irregular speed variation - like hand-drawn brush strokes
      const speedVariation = 1 + Math.sin(this.floatOffset * 0.5) * 0.4 + Math.sin(this.floatOffset * 1.3) * 0.2 + Math.sin(this.floatOffset * 2.7) * 0.1
      this.ensoProgress += this.getEnsoSpeed() * speedVariation

      // Draw enso background animation (behind everything)
      this.drawEnso()
    }

    // Draw home page if showing
    if (this.showHomePage) {
      this.drawHomePage()
      return // Don't draw other elements when showing home page
    }

    // Draw error message if Ollama is not available
    if (this.ollamaError) {
      this.drawOllamaError()
    }

    // Draw zen elements
    this.drawZenElements()

    // Always draw haiku if it exists (even if animation hasn't started)
    this.drawHaiku()

    // Draw Japanese haiku in center
    this.drawJapaneseHaiku()
  }

  private async generateHaiku(resetAnimation: boolean = false) {
    if (this.isGenerating) return
    this.isGenerating = true

    try {
      // Only reset enso animation if explicitly requested (e.g., first spacebar press)
      if (resetAnimation) {
        this.ensoProgress = 0
        this.ensoStartAngle = Math.random() * Math.PI * 2
        
        // Reset multiple starting angles and directions
        this.ensoStartAngles = []
        this.ensoDirections = []
        for (let i = 0; i < this.numEnsoCircles; i++) {
          this.ensoStartAngles.push(Math.random() * Math.PI * 2)
          // Randomly choose clockwise (-1) or counter-clockwise (1)
          this.ensoDirections.push(Math.random() < 0.5 ? -1 : 1)
        }
      }
      // Otherwise, keep animation running - don't reset ensoProgress
      
      // Initialize empty haiku lines for streaming
      this.currentHaiku = ['', '', '']
      this.initializeHaikuLines()
      
      // Not fading out - start fresh
      this.isFadingOut = false
      
      // Stream haiku from Ollama (text will appear as it's generated)
      await this.streamOllamaHaiku()
    } catch (error: any) {
      console.error('Error generating haiku:', error)
      // Set error message if it's a connection error
      if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError') || error.code === 'ECONNREFUSED') {
        this.ollamaError = 'Ollama is not running. Please start Ollama and try again.'
      } else if (!this.ollamaError) {
        this.ollamaError = `Error: ${error.message || 'Unknown error'}`
      }
      this.forceRedraw()
      // On error, clear haiku - don't show dummy text
      this.currentHaiku = ['', '', '']
      this.initializeHaikuLines()
      
      // Reset enso animation and pick new starting points even on error
      this.ensoProgress = 0
      this.ensoStartAngle = Math.random() * Math.PI * 2
      
      // Reset multiple starting angles and directions
      this.ensoStartAngles = []
      this.ensoDirections = []
      for (let i = 0; i < this.numEnsoCircles; i++) {
        this.ensoStartAngles.push(Math.random() * Math.PI * 2)
        // Randomly choose clockwise (-1) or counter-clockwise (1)
        this.ensoDirections.push(Math.random() < 0.5 ? -1 : 1)
      }
      
      this.isFadingOut = false
    } finally {
      this.isGenerating = false
    }
  }

  private async streamOllamaHaiku(): Promise<void> {
    // Generate haiku in English - simple and focused on emptiness
    const languageInstruction = 'in English'
    console.log('Generating haiku in English')
    
    const prompt = `Write a simple haiku about emptiness (sunyata) ${languageInstruction}. A haiku is a three-line poem with 5 syllables in the first line, 7 syllables in the second line, and 5 syllables in the third line. Keep it very simple and minimal. Focus on emptiness, void, nothingness, space, silence, or absence. Use simple, everyday words. Avoid complex imagery or metaphors. Return only the three lines of the haiku, one line per line, no extra text or explanation.`

    let response: Response
    try {
      response = await fetch(`${this.ollamaBaseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          stream: true
        })
      })
    } catch (error: any) {
      // Handle connection errors (Ollama not running)
      if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError') || error.code === 'ECONNREFUSED') {
        this.ollamaError = 'Ollama is not running. Please start Ollama and try again.'
        console.error('Ollama connection error:', error)
        this.forceRedraw()
        throw error
      }
      throw error
    }

    if (!response.ok) {
      this.ollamaError = `Ollama API error: ${response.status}`
      this.forceRedraw()
      throw new Error(`Ollama API error: ${response.status}`)
    }
    
    // Clear error if connection successful
    this.ollamaError = null

    const reader = response.body?.getReader()
    const decoder = new TextDecoder()

    if (!reader) {
      throw new Error('Failed to get response reader')
    }

    let buffer = ''
    let fullText = ''

    while (true) {
      const { done, value } = await reader.read()
      
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.trim() === '') continue
        
        try {
          const json = JSON.parse(line)
          
          if (json.message?.content) {
            fullText += json.message.content
            
            // Parse into lines as we receive text
            const textLines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0)
            
            // Update English haiku lines with full text (generating English first)
            for (let i = 0; i < 3 && i < textLines.length; i++) {
              // Filter out common prefixes
              let cleanLine = textLines[i]
              if (cleanLine.match(/^(haiku|here|here's|here is)/i)) {
                continue
              }
              this.currentHaiku[i] = cleanLine
              
              // Update the line and mark as streaming
              // Ensure haikuLines array has enough entries
              while (this.haikuLines.length <= i) {
                this.haikuLines.push({
                  text: '',
                  displayedText: '',
                  particles: [],
                  baseAngle: 0,
                  streaming: false
                })
              }
              
              // Update currentHaiku first
              this.currentHaiku[i] = cleanLine
              
              // Re-initialize particles if they don't exist or don't match text length
              const expectedParticleCount = cleanLine.replace(/\s/g, '').length
              if (!this.haikuLines[i].particles || this.haikuLines[i].particles.length !== expectedParticleCount) {
                // Reinitialize all lines to ensure proper setup
                this.initializeHaikuLines()
              }
              
              // Update the line properties
              this.haikuLines[i].text = cleanLine
              this.haikuLines[i].streaming = true
              
              // Make particles visible immediately when text is set
              if (this.haikuLines[i].particles) {
                const textLength = cleanLine.replace(/\s/g, '').length
                this.haikuLines[i].particles.forEach((particle, idx) => {
                  if (idx < textLength) {
                    particle.visible = true
                    // Ensure high opacity for visibility
                    if (particle.opacity < 0.9) {
                      particle.opacity = 0.9
                    }
                  }
                })
              }
              
              // Force a fake redraw by temporarily resizing canvas
              this.forceRedraw()
            }
          }

          if (json.done) {
            // Finalize English haiku - ensure all text is displayed
            this.currentHaiku = this.parseHaiku(fullText)
            console.log('English haiku finalized:', this.currentHaiku)
            
            // Make sure all displayed text matches final text
            for (let i = 0; i < this.haikuLines.length; i++) {
              if (this.haikuLines[i] && this.currentHaiku[i]) {
                this.haikuLines[i].text = this.currentHaiku[i]
                this.haikuLines[i].streaming = false
                // Ensure all particles are visible
                if (this.haikuLines[i].particles) {
                  this.haikuLines[i].particles.forEach(particle => {
                    particle.visible = true
                    if (particle.opacity < 0.8) {
                      particle.opacity = 0.8
                    }
                  })
                }
              }
            }
            
            // No translation needed - haiku is already in the target language
            // The haiku is generated directly in the current language
            
            // Force final redraw with fake resize
            this.forceRedraw()
            return
          }
        } catch (e) {
          // Skip invalid JSON lines
          continue
        }
      }
    }

    // Finalize if stream ended without done flag
    if (fullText) {
      // The fullText is English haiku (generated first)
      this.currentHaiku = this.parseHaiku(fullText)
      console.log('English haiku finalized (no done flag):', this.currentHaiku)
      
      // Ensure all displayed text matches final text
      for (let i = 0; i < this.haikuLines.length; i++) {
        if (this.haikuLines[i] && this.currentHaiku[i]) {
          this.haikuLines[i].text = this.currentHaiku[i]
          this.haikuLines[i].streaming = false
        }
      }
      
      // No translation needed - haiku is already in the target language
      // The haiku is generated directly in the current language
      
      // Force redraw after translation
      this.forceRedraw()
    }
  }

  // Removed unused method callOllamaForHaiku - using streamOllamaHaiku instead

  private parseHaiku(text: string): string[] {
    const lines = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.match(/^(haiku|here|here's)/i))
      .slice(0, 3)

    // Return empty lines if we don't have 3 lines - don't use dummy text
    if (lines.length < 3) {
      return ['', '', '']
    }

    return lines.slice(0, 3)
  }

  // Removed unused translateToJapanese method - only English haikus are generated now

  // Removed unused method fadeOutCurrentHaiku - fade out is handled in drawHaiku()

  private initializeHaikuLines() {
    this.haikuLines = []
    // Position text to follow the enso animation - distributed along the circle
    const totalLines = this.currentHaiku.length
    const fullCircle = Math.PI * 2 - 0.12 // Full circle minus gap
    const angleStep = fullCircle / totalLines // Distribute evenly

    this.currentHaiku.forEach((text, index) => {
      if (text && text.trim()) {
        // Calculate starting angle - distributed along the circle starting from enso start
        const baseAngle = this.ensoStartAngle + (index * angleStep)
        
        // Create particles for each letter
        const particles: LetterParticle[] = []
        const cleanText = text.trim()
        // Filter out spaces and count only actual characters
        const chars = cleanText.split('').filter(c => c !== ' ')
        const textLength = chars.length
        
        // Better spacing: distribute letters more evenly along the arc
        // Use a larger portion of the angle step for better spacing
        const letterAngleStep = (angleStep * 0.8) / Math.max(textLength - 1, 1) // Better distribution
        
        let charIndex = 0
        for (let i = 0; i < cleanText.length; i++) {
          const char = cleanText[i]
          if (char === ' ') {
            // For spaces, add a small gap but don't create a particle
            charIndex += 0.3 // Small gap for spaces
            continue
          }
          
          // Better spacing: center the text and distribute evenly
          const offsetFromCenter = (charIndex - (textLength - 1) / 2)
          const letterAngle = baseAngle + offsetFromCenter * letterAngleStep
          const radius = this.ensoRadius
          
          particles.push({
            char: char,
            targetAngle: letterAngle,
            currentAngle: letterAngle,
            radius: radius,
            opacity: 0.3, // Start with initial opacity so text is visible from beginning
            x: this.ensoCenterX + Math.cos(letterAngle) * radius,
            y: this.ensoCenterY + Math.sin(letterAngle) * radius,
            targetX: this.ensoCenterX + Math.cos(letterAngle) * radius,
            targetY: this.ensoCenterY + Math.sin(letterAngle) * radius,
            velocityX: 0,
            velocityY: 0,
            visible: true, // Make visible from the beginning
            baseRadius: radius
          })
          
          charIndex++
        }
        
        this.haikuLines.push({
          text: cleanText,
          displayedText: '', // Start empty for streaming
          particles: particles,
          baseAngle: baseAngle,
          streaming: false
        })
      }
    })
  }

  private drawHaiku() {
    if (this.haikuLines.length === 0) {
      // Don't show any text while generating
      return
    }
    
    // Force all particles to be visible if they have text
    this.haikuLines.forEach(line => {
      if (line.text && line.text.trim() !== '' && line.particles) {
        const textWithoutSpaces = line.text.replace(/\s/g, '')
        line.particles.forEach((particle, idx) => {
          if (idx < textWithoutSpaces.length) {
            particle.visible = true
            if (particle.opacity < 0.8) {
              particle.opacity = 0.8
            }
          }
        })
      }
    })

    this.haikuLines.forEach((line, index) => {
      // Safety check - ensure particles exist
      if (!line.particles) {
        return
      }
      
      // Handle fade out - fade out particles (only when explicitly fading out)
      if (this.isFadingOut && line.text) {
        line.particles.forEach(particle => {
          particle.opacity = Math.max(0, particle.opacity - this.fadeOutSpeed)
          if (particle.opacity <= 0) {
            particle.visible = false
          }
        })
        // Only clear displayed text when fully faded out
        if (line.particles.length > 0 && line.particles.every(p => p.opacity <= 0)) {
          line.displayedText = ''
        }
      } else if (!this.isFadingOut && line.text && line.text.trim() !== '') {
        // When not fading out and we have text, ensure particles stay visible
        line.particles.forEach((particle, idx) => {
          if (idx < line.text.length) {
            particle.visible = true
            // Ensure minimum opacity
            if (particle.opacity < 0.3) {
              particle.opacity = 0.3
            }
          }
        })
      } 
      // Handle streaming - letter by letter effect (very slowly) with fade in
      else if (line.streaming && line.text && line.text.trim() !== '') {
        // Animate displayed text to catch up with full text (letter by letter, very slowly)
        if (line.displayedText.length < line.text.length) {
          // Faster: add characters more frequently so text appears earlier
          // Use a faster rate - add character more often to show with enso contrast
          const shouldAddChar = Math.random() < 0.35 // 35% chance per frame to add a character
          if (shouldAddChar) {
            line.displayedText = line.text.substring(0, Math.min(
              line.displayedText.length + 1, // Add only 1 character at a time
              line.text.length
            ))
          }
        } else {
          line.displayedText = line.text
        }
        // Particles will fade in individually in the drawing loop
      }
      // Handle fade in after streaming completes
      else if (line.text && line.text.trim() !== '') {
        // Ensure displayed text matches full text
        if (line.displayedText !== line.text) {
          line.displayedText = line.text
          // Make all particles visible
          line.particles.forEach(particle => {
            particle.visible = true
          })
        }
      }

      // Safety check - ensure particles exist
      if (!line.particles || line.particles.length === 0) {
        return
      }
      
      // Update and draw letter particles
      // IMPORTANT: Calculate text without spaces once for all particles
      const textWithoutSpaces = line.text ? line.text.replace(/\s/g, '') : ''
      
      line.particles.forEach((particle, particleIndex) => {
        // Particles are visible from the beginning, but we can still check displayedText for streaming effect
        // Always show particles if they exist and have text
        // IMPORTANT: Compare against text WITHOUT spaces since particles don't include spaces
        const hasText = line.text && line.text.trim() !== '' && particleIndex < textWithoutSpaces.length
        
        if (hasText) {
          // Ensure particle is visible if we have text
          if (!particle.visible) {
            particle.visible = true
          }
          // Ensure minimum opacity for visibility
          if (particle.opacity < 0.3) {
            particle.opacity = 0.3
          }
        }
        
        // Only hide if we don't have text AND we're not in the middle of streaming
        if (!hasText && !line.streaming) {
          if (particle.visible) {
            particle.visible = false
          }
          return
        }
        
        if (!particle.visible) return
        
        // Update particle position to follow enso animation
        // Update target angle to follow enso smoothly
        particle.currentAngle += (particle.targetAngle - particle.currentAngle) * 0.02
        
        // Add floating effect - increased amplitude for more noticeable float
        const floatAmount = Math.sin(this.floatOffset + particleIndex * 0.3 + index) * 5
        const radiusWithFloat = particle.baseRadius + floatAmount
        
        // Add additional vertical floating offset for more natural movement
        const verticalFloat = Math.cos(this.floatOffset * 0.7 + particleIndex * 0.4 + index) * 4
        
        // Calculate target position with floating
        const baseX = this.ensoCenterX + Math.cos(particle.currentAngle) * radiusWithFloat
        const baseY = this.ensoCenterY + Math.sin(particle.currentAngle) * radiusWithFloat
        
        // Apply floating offset perpendicular to the circle
        const perpAngle = particle.currentAngle + Math.PI / 2
        particle.targetX = baseX + Math.cos(perpAngle) * verticalFloat * 0.3
        particle.targetY = baseY + Math.sin(perpAngle) * verticalFloat
        
        // Smooth particle movement with velocity
        const damping = 0.85
        particle.velocityX += (particle.targetX - particle.x) * 0.1
        particle.velocityY += (particle.targetY - particle.y) * 0.1
        particle.velocityX *= damping
        particle.velocityY *= damping
        
        particle.x += particle.velocityX
        particle.y += particle.velocityY
        
        // Update opacity - fade in when visible (faster to show with enso contrast)
        // But don't reduce opacity if particle should be visible
        // textWithoutSpaces already declared above
        if (particle.visible && line.text && particleIndex < textWithoutSpaces.length) {
          // Ensure opacity doesn't go below minimum
          if (particle.opacity < 0.3) {
            particle.opacity = 0.3
          }
          // Fade in towards full opacity
          if (particle.opacity < 1) {
            particle.opacity = Math.min(1, particle.opacity + this.fadeInSpeed * 1.5)
          }
        }
        
        // Always draw if visible and has text, even with low opacity
        if (!particle.visible || (particle.opacity <= 0 && line.text && particleIndex < textWithoutSpaces.length)) {
          // If particle has text but opacity is 0, restore it
          if (line.text && particleIndex < textWithoutSpaces.length) {
            particle.visible = true
            particle.opacity = 0.3
          } else {
            return
          }
        }

        // Use simpler font for English haiku - smaller size
        const fontSize = 20
        const fontFamily = this.englishFont
        
        this.ctx.font = `${fontSize}px ${fontFamily}`
        this.ctx.textAlign = 'center'
        this.ctx.textBaseline = 'middle'
        
        // Better text rendering
        this.ctx.imageSmoothingEnabled = true
        this.ctx.imageSmoothingQuality = 'high'
        
        // Ensure text is actually drawn - force rendering
        this.ctx.globalAlpha = particle.opacity

        // Calculate rotation angle (tangent to circle)
        const rotationAngle = particle.currentAngle + Math.PI / 2
        
        // Draw particle (letter) with rotation
        this.ctx.save()
        this.ctx.translate(particle.x, particle.y)
        this.ctx.rotate(rotationAngle)
        
        // Use globalAlpha for proper opacity rendering - apply 60% transparency (40% opacity)
        // But respect fade in/out effects
        const baseOpacity = Math.max(0, particle.opacity) // Base opacity from particle (can be 0 during fade out)
        const drawOpacity = baseOpacity * 0.4 // Apply 60% transparency (40% opacity)
        this.ctx.globalAlpha = Math.max(0, drawOpacity) // Ensure opacity doesn't go negative
        
        // Convert to lowercase for English haiku
        const displayChar = particle.char.toLowerCase()
        
        // Draw white stroke first (outline)
        this.ctx.strokeStyle = `rgb(255, 255, 255)`
        this.ctx.lineWidth = 2
        this.ctx.lineJoin = 'round'
        this.ctx.lineCap = 'round'
        this.ctx.strokeText(displayChar, 0, 0)
        
        // Draw white fill on top
        this.ctx.fillStyle = `rgb(255, 255, 255)` // White
        this.ctx.fillText(displayChar, 0, 0)
        
        // Debug: log first few characters to verify drawing
        if (particleIndex < 3 && index === 0) {
          console.log(`Drawing char: ${particle.char}, opacity: ${drawOpacity}, visible: ${particle.visible}, x: ${particle.x}, y: ${particle.y}`)
        }
        
        // Reset global alpha
        this.ctx.globalAlpha = 1.0
        this.ctx.restore()
      })
    })
  }

  private drawHomePage() {
    this.ctx.save()
    
    // Clear canvas with white background
    this.ctx.fillStyle = 'rgb(255, 255, 255)'
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    
    // Center position
    const centerX = this.canvas.width / 2
    const centerY = this.canvas.height / 2
    
    // Title
    this.ctx.fillStyle = 'rgb(0, 0, 0)'
    this.ctx.font = '48px Cormorant Garamond, Playfair Display, Georgia, serif'
    this.ctx.textAlign = 'center'
    this.ctx.textBaseline = 'middle'
    this.ctx.fillText('Emptiness Generator', centerX, centerY - 150)
    
    // Instructions
    const instructions = [
      'Press SPACEBAR to begin',
      '',
      'A haiku will be generated about',
      'sunyata (emptiness)',
      '',
      'Haikus are generated in English',
      '',
      'The haiku appears along the',
      'circular animation and in the center',
      '',
      'New haikus generate every 20 seconds',
      'with fade in and fade out effects'
    ]
    
    this.ctx.fillStyle = 'rgb(100, 100, 100)'
    this.ctx.font = '20px Arial, Helvetica, sans-serif'
    this.ctx.textAlign = 'center'
    
    const lineHeight = 32
    const startY = centerY - 50
    
    instructions.forEach((line, index) => {
      const y = startY + (index * lineHeight)
      this.ctx.fillText(line, centerX, y)
    })
    
    // Subtle enso circle decoration
    this.ctx.strokeStyle = 'rgba(200, 200, 200, 0.3)'
    this.ctx.lineWidth = 2
    this.ctx.beginPath()
    this.ctx.arc(centerX, centerY + 200, 80, 0, Math.PI * 2)
    this.ctx.stroke()
    
    this.ctx.restore()
  }

  private drawOllamaError() {
    this.ctx.save()
    
    // Center position
    const centerX = this.canvas.width / 2
    const centerY = this.canvas.height / 2
    
    // Draw semi-transparent background
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    this.ctx.fillRect(centerX - 300, centerY - 60, 600, 120)
    
    // Draw error text
    this.ctx.fillStyle = 'rgb(200, 0, 0)'
    this.ctx.font = '24px Arial, Helvetica, sans-serif'
    this.ctx.textAlign = 'center'
    this.ctx.textBaseline = 'middle'
    
    if (this.ollamaError) {
      const lines = this.ollamaError.split('\n')
      lines.forEach((line, index) => {
        this.ctx.fillText(line, centerX, centerY - 20 + (index * 30))
      })
    }
    
    // Draw instruction text
    this.ctx.fillStyle = 'rgb(100, 100, 100)'
    this.ctx.font = '18px Arial, Helvetica, sans-serif'
    this.ctx.fillText('Make sure Ollama is running on localhost:11434', centerX, centerY + 30)
    
    this.ctx.restore()
  }

  private drawJapaneseHaiku() {
    // Draw the haiku in center (it's already in the target language, no translation needed)
    // Use currentHaiku instead of currentHaikuJapanese since we're generating directly in the language
    if (!this.currentHaiku || this.currentHaiku.length === 0) {
      return
    }
    
    // Check if at least one line has content
    const hasContent = this.currentHaiku.some(line => line && line.trim() !== '')
    if (!hasContent) {
      return
    }

    this.ctx.save()
    
    // Ensure full opacity for Japanese text
    this.ctx.globalAlpha = 1.0
    
    // Center position
    const centerX = this.canvas.width / 2
    const centerY = this.canvas.height / 2
    
    // Font settings - use a font that supports multiple scripts including Tibetan (བོད་ཡིག)
    const fontSize = 24
    // Use a font stack that includes support for various scripts including Tibetan
    const multiScriptFont = 'Hiragino Mincho ProN, Hiragino Mincho Pro, Yu Mincho, YuMincho, Meiryo, MS PGothic, MS PMincho, "Noto Sans Tibetan", "Noto Serif Tibetan", "Kailasa", "Microsoft Himalaya", "Noto Sans", "Noto Serif", serif'
    this.ctx.font = `${fontSize}px ${multiScriptFont}`
    this.ctx.textAlign = 'center'
    this.ctx.textBaseline = 'middle'
    
    // Line height
    const lineHeight = fontSize * 1.6
    
    // Draw each line of haiku in center (in the current language)
    // Use currentHaiku since we're generating directly in the language
    this.currentHaiku.forEach((line, index) => {
      if (!line || !line.trim()) return
      
      const y = centerY + (index - 1) * lineHeight
      
      // Draw white stroke
      this.ctx.strokeStyle = `rgb(255, 255, 255)`
      this.ctx.lineWidth = 2
      this.ctx.lineJoin = 'round'
      this.ctx.lineCap = 'round'
      this.ctx.strokeText(line, centerX, y)
      
      // Draw black fill
      this.ctx.fillStyle = `rgb(0, 0, 0)`
      this.ctx.fillText(line, centerX, y)
    })
    
    this.ctx.restore()
  }

  private drawEnso() {
    // Enso circle animation - draws multiple circles from different starting points
    // Don't auto-reset here - it will reset when new haiku is generated
    // Just wrap around if it goes past 1 (shouldn't happen with sync, but safety check)
    if (this.ensoProgress >= 1) {
      this.ensoProgress = 1 // Keep at 1 until reset by new haiku
    }

    // Draw multiple enso circles, each starting from a different point
    for (let circleIndex = 0; circleIndex < this.numEnsoCircles; circleIndex++) {
      const startAngle = this.ensoStartAngles[circleIndex] || (this.ensoStartAngle + (circleIndex * Math.PI * 2 / this.numEnsoCircles))
      const endAngle = startAngle + Math.PI * 2 * this.ensoProgress
      const gapSize = 0.12 // Gap in the circle

      // Adjust end angle to leave a gap (accounting for start angle)
      const fullCircle = Math.PI * 2
      const adjustedStartAngle = startAngle
      let adjustedEndAngle = endAngle
      // Calculate the gap position relative to start angle
      const gapEndAngle = adjustedStartAngle + fullCircle - gapSize
      if (endAngle > gapEndAngle) {
        adjustedEndAngle = gapEndAngle
      }

      this.ctx.save()
      
      // Draw multiple layers for ink-like depth and presence
      const numLayers = 3
    
    for (let layer = 0; layer < numLayers; layer++) {
      const layerOffset = layer * 0.5
      const layerOpacity = this.ensoOpacity * (1 - layer * 0.15)
      const layerRadius = this.ensoRadius + layerOffset - layerOffset * 0.3
      
      // Draw segments with irregular brush pressure (more organic, hand-drawn effect)
      const segments = 80 // More segments for smoother irregularity
      const totalAngle = adjustedEndAngle - adjustedStartAngle
      const segmentAngle = totalAngle / segments
      
      for (let i = 0; i < segments; i++) {
        const segStart = adjustedStartAngle + i * segmentAngle
        const segEnd = adjustedStartAngle + (i + 1) * segmentAngle
        
        // Multiple overlapping sine waves for more irregular pressure variation
        const pressure1 = Math.sin(segStart * 7.3 + this.floatOffset * 2.1) * 0.35
        const pressure2 = Math.sin(segStart * 13.7 + this.floatOffset * 3.4) * 0.25
        const pressure3 = Math.sin(segStart * 19.2 + this.floatOffset * 1.7) * 0.15
        const pressureVariation = 0.5 + pressure1 + pressure2 + pressure3
        
        // Irregular ink intensity with multiple frequencies
        const intensity1 = Math.sin(segStart * 11.5 + this.floatOffset * 2.8) * 0.25
        const intensity2 = Math.sin(segStart * 17.3 + this.floatOffset * 4.1) * 0.15
        const inkIntensity = 0.6 + intensity1 + intensity2
        
        // Add random-like variation using noise-like function
        const noise = Math.sin(segStart * 23.7 + this.floatOffset * 5.3) * 0.1
        
        // Dynamic line width - very thick like bold ink brush
        const baseWidth = 60 + layer * 15 // Even thicker for bold ink appearance
        const lineWidth = baseWidth * pressureVariation * inkIntensity * (1 + noise)
        
        // Irregular radius variation - makes the circle wobble slightly
        const radiusVariation = Math.sin(segStart * 5.1 + this.floatOffset * 1.5) * 2 + 
                               Math.sin(segStart * 8.7 + this.floatOffset * 2.3) * 1
        const currentRadius = layerRadius + radiusVariation
        
        // Ink color - match text color (dark gray/black)
        const baseColor = 25 // Match text color
        const inkColor = baseColor + (layer * 2) - (pressureVariation * 5) - (noise * 3)
        const alpha = layerOpacity * inkIntensity
        
        this.ctx.strokeStyle = `rgba(${inkColor}, ${inkColor}, ${inkColor}, ${alpha})`
        this.ctx.lineWidth = lineWidth
        this.ctx.lineCap = 'round'
        this.ctx.lineJoin = 'round'
        
        // Draw segment with irregular radius
        this.ctx.beginPath()
        this.ctx.arc(
          this.ensoCenterX,
          this.ensoCenterY,
          currentRadius,
          segStart,
          segEnd
        )
        this.ctx.stroke()
      }
    }
    
    // Draw ink bleeding effect at the current drawing point for this circle
      if (this.ensoProgress > 0.05) {
        const currentAngle = adjustedEndAngle
        const bleedRadius = 8 + Math.sin(this.floatOffset * 4) * 3
        // Use the actual radius with variation for bleeding position
        const bleedRadiusVariation = Math.sin(currentAngle * 5.1 + this.floatOffset * 1.5) * 2
        const bleedX = this.ensoCenterX + Math.cos(currentAngle) * (this.ensoRadius + bleedRadiusVariation)
        const bleedY = this.ensoCenterY + Math.sin(currentAngle) * (this.ensoRadius + bleedRadiusVariation)
        
        // Create radial gradient for ink bleed - match text color
        const bleedGradient = this.ctx.createRadialGradient(
          bleedX, bleedY, 0,
          bleedX, bleedY, bleedRadius
        )
        bleedGradient.addColorStop(0, `rgba(25, 25, 25, ${this.ensoOpacity * 0.6})`)
        bleedGradient.addColorStop(0.5, `rgba(30, 30, 30, ${this.ensoOpacity * 0.3})`)
        bleedGradient.addColorStop(1, `rgba(25, 25, 25, 0)`)
        
        this.ctx.fillStyle = bleedGradient
        this.ctx.beginPath()
        this.ctx.arc(bleedX, bleedY, bleedRadius, 0, Math.PI * 2)
        this.ctx.fill()
      }
      
      this.ctx.restore()
    }
  }

  private drawZenElements() {
    // Subtle dots (keeping minimal background elements)
    for (let i = 0; i < 8; i++) {
      const alpha = (Math.sin(this.floatOffset + i) + 1) / 2 * 0.1
      const x = (this.canvas.width / 9) * (i + 1)
      const y = this.canvas.height / 3 + Math.sin(this.floatOffset + i) * 50

      this.ctx.fillStyle = `rgba(220, 220, 220, ${alpha})`
      this.ctx.beginPath()
      this.ctx.arc(x, y, 3, 0, Math.PI * 2)
      this.ctx.fill()
    }
  }

  // Removed unused method sleep
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing haiku generator...')
    new ZenHaikuGenerator()
  })
} else {
  console.log('Initializing haiku generator...')
  new ZenHaikuGenerator()
}
