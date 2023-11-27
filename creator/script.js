const blockSize = 16 // bytes (for AES, IV)
  const saltSize = 16 // bytes (for PBKDF2)
  const iterations = 1000000 // key derivation (with PBKDF2)
  const keySize = 32 // bytes (derived with PBKDF2, used by AES)

  const inputElementIds = {
    "message": "text_input_div"
  }

  let selectedInputType = ""

  async function init() {
    await refreshSalt()
    await refreshIV()   
  }

  async function encrypt() {

    // All cryptography is delegated to the browser engine through.
    // W3C Web Cryptography API standard
    // https://www.w3.org/TR/WebCryptoAPI/
    // No cryptography was hand-rolled in the making of this tool. ;-)

    setMessage("⏳ Importing key...")

    // Whatever array of bytes is in the password field
    let password = new TextEncoder().encode(document.getElementById("password").value)

    if (password.length == 0) {
      throw new Error(`Empty password`)
    }

    // Import password into a Key suitable for use with Cryptography APIs
    let passwordKey = await window.crypto.subtle.importKey(
      "raw",  // a puny array of bytes
      password,
      {name: "PBKDF2"}, // What will use this key
      false, // key is not extractable
      ["deriveKey"] // What they can use it for
    )

    setMessage("⏳ Deriving key from password...")

    // Salt input field (0x string)
    let saltHexString = document.getElementById("salt").value

    // Salt for password derivation with PBKDF2 (byte array)
    let salt = hexStringToBytes(saltHexString)

    if (salt.length != saltSize) {
      throw new Error(`Unexpected salt length: ${salt.length}`)
    }

    // 'Strech' a password into a cryptographically secure key of a given size
    let key = await window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2", // https://en.wikipedia.org/wiki/PBKDF2
        salt: salt, // for flavor
        iterations: iterations, // how long to stomp on the password
        hash: "SHA-1", // As per standard v2.0
      },
      passwordKey, // Wrapped password
      {
        name: "AES-GCM", // What is this key for
        length: keySize * 8 // key size in bits
      },
      false, // key is not extractable
      ["encrypt"]
    )

    setMessage("⏳ Preparing inputs...")

    // IV input field (0x string)
    let ivHexString = document.getElementById("iv").value

    // IV for AES
    let iv = hexStringToBytes(ivHexString)

    if (iv.length != blockSize) {
      throw new Error(`Unexpected IV length: ${iv.length}`)
    }

    let plainText = new Uint8Array()
    let fileExtension = ""
    // TODO move this messy stuff out of encrypt path
    // TODO handle files with no extension (currently captures full filename as extension)
    // TODO file and image are identical except for input field
    if (selectedInputType == '') {
      throw new Error(`Select input type (message, file, image)`)
    } else if (selectedInputType == 'message') {
      // Message input field, as array of bytes
      plainText = new TextEncoder().encode(document.getElementById("text_input").value);
    } else if (selectedInputType == 'image') {
      files = document.getElementById("image_input").files
      if (files.length < 1) {
        throw new Error(`No file selected`)
      }
      f = files[0]
      fileContent = await f.arrayBuffer()
      plainText = new Uint8Array(fileContent)
      fileExtension = f.name.split(".").pop()
    } else if (selectedInputType == 'file') {
      files = document.getElementById("file_input").files
      if (files.length < 1) {
        throw new Error(`No file selected`)
      }
      f = files[0]
      fileContent = await f.arrayBuffer()
      plainText = new Uint8Array(fileContent)
      fileExtension = f.name.split(".").pop()
    } else {
      throw new Error(`Unhandled input type: '${selectedInputType}'`)
    }

    console.log(plainText)
    if (plainText.length <= 0) {
      throw new Error(`Plaintext is empty`)
    }

    // Pad plaintext to block size, as describe in:
    // https://en.wikipedia.org/wiki/Padding_(cryptography)#PKCS#5_and_PKCS#7
    plaintText = function(input) {
      output = []
      padAmount = blockSize - (input.length % blockSize)
      for (var i = 0; i < input.length; i++) {
        output.push(input[i])
      }
      for (var i = 0; i < padAmount; i++) {
        output.push(padAmount)
      }
      return Uint8Array.from(output);
    }(plainText)

    setMessage("⏳ Encrypting...")

    // Encrypt with AES in 'Galois/Counter Mode' (integrity + confidentiality)
    // https://en.wikipedia.org/wiki/Galois/Counter_Mode
    let cipherBuffer = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      key,
      plaintText
    )
    let cipherHexString = bytesToHexString(new Uint8Array(cipherBuffer))

    return {
      salt: saltHexString,
      iv: ivHexString,
      cipher: cipherHexString,
      extension: fileExtension,
    }
  }

  async function createSecret() {

    setMessage("⏳ Creating Secret...")

    async function loadTemplate(name) {
      response = await fetch("./" + name)
      if (!response.ok) {
        throw new Error(`Failed to retrieve: ${name} response: ${response.status}`)
      }
      return await response.text()
    }

    try {

      setMessage("⏳ Begin encryption...")

      // Return salt IV cipher as hex strings
      let encryption = await encrypt()
      document.getElementById("cipher").innerHTML = encryption.cipher //0x string

      setMessage("⏳ Retrieving templates...")

      const pageTemplate = await loadTemplate("secret-template.html")
      const valuesTemplate = await loadTemplate("values.js")

      const passwordHint = document.getElementById("password_hint").value

      setMessage("⏳ Generating download blob...")

      values = valuesTemplate
      values = values.replaceAll("'{.SALT_SIZE}'", saltSize)
      values = values.replaceAll("'{.BLOCK_SIZE}'", blockSize)
      values = values.replaceAll("'{.KEY_SIZE}'", keySize)
      values = values.replaceAll("'{.ITERATIONS}'", iterations)
      values = values.replaceAll("'{.SALT_HEX}'", encryption.salt)
      values = values.replaceAll("'{.IV_HEX}'", encryption.iv)
      values = values.replaceAll("'{.CIPHER_HEX}'", encryption.cipher)
      values = values.replaceAll("'{.SECRET_TYPE}'", selectedInputType)
      values = values.replaceAll("'{.SECRET_EXTENSION}'", encryption.extension)

      secretPage = pageTemplate
      secretPage = secretPage.replaceAll("{{PASSWORD_HINT}}", passwordHint)
      secretPage = secretPage.replaceAll("{{VALUES}}", values)

      var blob = new Blob([secretPage], {'type':'text/html'});
      document.getElementById("target_link").setAttribute("href", window.URL.createObjectURL(blob))
      document.getElementById("target_link").hidden = false

      setMessage("✅ Ready for download")

    } catch (err) {
      setMessage("❌ " + err)
    }
  }

  async function setMessage(newMessage) {
    document.getElementById("errormsg").innerHTML = newMessage
  }

  async function refreshSalt() {
    let salt = crypto.getRandomValues(new Uint8Array(saltSize));
    document.getElementById("salt").value = bytesToHexString(salt)
    setMessage("Refreshed salt")
  }

  async function refreshIV() {
    let iv = crypto.getRandomValues(new Uint8Array(blockSize));
    document.getElementById("iv").value = bytesToHexString(iv)
    setMessage("Refreshed IV")
  }

  function bytesToHexString(input) {
    for (var hex = [], i = 0; i < input.length; i++) {
      var current = input[i] < 0 ? input[i] + 256 : input[i];
      hex.push((current >>> 4).toString(16));
      hex.push((current & 0xF).toString(16));
    }
    return hex.join("");
  }

  function hexStringToBytes(input) {
    // TODO accepts invalid (non-hex) values, e.g. ZZZZ
    for (var bytes = [], c = 0; c < input.length; c += 2) {
      bytes.push(parseInt(input.substr(c, 2), 16));
    }
    return Uint8Array.from(bytes);
  }

  function setInputType(selectedType) {
    selectedInputType = selectedType;

    for (let type in inputElementIds) {
      let element = document.getElementById(inputElementIds[type])
      if (type == selectedType) {
        element.hidden = false
      } else {
        element.hidden = true
      }
    }

    setMessage("Ready to encrypt 👍")
  }