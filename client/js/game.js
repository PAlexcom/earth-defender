/////////////////////////////////////////////////////
// Game Renderer and Logic
/////////////////////////////////////////////////////
var Game = function (config) {
    this.light = new Light(
        new THREE.Vector3(400, 0, 0),
        10000,
        new THREE.Vector3(0.09, 0.09, 0.1),
        new THREE.Vector3(0.4, 0.4, 0.4)
    );
    this.bullets = new THREE.Object3D;
    this.sun = null;
    this.earth = null;
    this.moon = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.spaceShip = null;
    this.meteorites = null;
    this.maxMeteorietes = config.maxMeteorietes || 200;
    this.controls = null;
    this.gui = null;
    this.stats = null;
    this.counter = 0;
    this.maxLife = config.maxLife || 1000;
    this.life = this.maxLife;
    this.score = 0;
    this.requestAnimationFrameId = null;
    this.players = 0;
    this.maxPlayers = config.maxPlayers || 10;
    this.debug = config.debug || false;
    this.server = null;
    this.isMultiplayer = config.isMultiplayer || false;
    this.DOMHandler = new GameDOMHandler(this);
    this.roomId = null;

    if (this.isMultiplayer) {
        if (config.servers) {
            this.server = new GameClient({servers: config.servers, game: this});
        } else {
            throw new Error("A default server should be provided");
        }
    }

    if (this.debug) {
        this.initGui();
    }
};
Game.prototype.constructor = Game;
Game.prototype.createUniforms = function () {
    var uniforms = {
        lightPosition: {
            type: 'v3',
            value: this.light.lightPosition
        },
        ambient: {
            type: 'v3',
            value: this.light.ambientValue
        },
        rho: {
            type: "v3",
            value: this.light.rho
        },
        lightPower: {
            type: "f",
            value: this.light.lightPower
        },
        texture: {
            type: "t",
            value: THREE.ImageUtils.loadTexture('img/earth.jpg')
        }
    };

    uniforms.texture.value.minFilter = THREE.NearestMipMapNearestFilter;

    return uniforms;
};
Game.prototype.createVertexShader = function () {
    return document.getElementById("vertex").textContent;
};
Game.prototype.createFragmentShader = function () {
    return document.getElementById("fragment").textContent;
};
Game.prototype.setLife = function (life) {
    this.life = Math.max(life, 0);
    this.DOMHandler.setLife(this.life);
    if (this.life === 0) {
        this.stop("Game Over");
    }
};
Game.prototype.decreaseLife = function () {
    this.setLife(this.life - 200);
    this.server.send("action_earth_collision");
};
Game.prototype.initCamera = function () {
    var camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
    camera.position.z = 500;

    return camera;
};
Game.prototype.updatePlayers = function () {
    this.DOMHandler.setPlayers(this.players);
};
Game.prototype.setPlayers = function (players) {
    this.players = players;
    this.updatePlayers();
};
Game.prototype.setRoomsList = function (roomList) {
    this.DOMHandler.updateRoomsList(roomList);
};
Game.prototype.initSun = function () {
    var sun = new Sun();
    sun = sun.create();
    sun.position.x = 400;

    return sun;
};
Game.prototype.initEarth = function () {
    var earth = new Earth();
    earth = earth.create(
        this.createUniforms(),
        this.createVertexShader(),
        this.createFragmentShader()
    );
    earth.rotation.z = 10 * Math.PI / 180;

    return earth;
};
Game.prototype.initRender = function () {
    var renderer = new THREE.WebGLRenderer({antialias: true});
    renderer.setSize(window.innerWidth, window.innerHeight);

    return renderer;
};
Game.prototype.initSpaceShip = function () {
    var spaceShip = new SpaceShip();
    spaceShip = spaceShip.create(
        this.createUniforms(),
        this.createVertexShader(),
        this.createFragmentShader()
    );
    spaceShip.position.x = Math.random() * 200 + 100;
    spaceShip.rotation.z = 90 * Math.PI / 180;

    return spaceShip;
};
Game.prototype.initMoon = function () {
    var tmpMoon = new Moon();
    tmpMoon = tmpMoon.create(
        this.createUniforms(),
        this.createVertexShader(),
        this.createFragmentShader()
    );
    tmpMoon.position.x = 200;

    var moon = new THREE.Object3D();
    moon.add(tmpMoon);

    return moon;
};
Game.prototype.initMeteorites = function (numMeteorites) {
    var meteorites = new THREE.Object3D();
    for (var i = 0; i < numMeteorites; i++) {
        var meteorite = new Meteorite().create(
            this.createUniforms(),
            this.createVertexShader(),
            this.createFragmentShader()
        );
        meteorite.position.x = Math.random() * 1000 - Math.random() * 1000;
        meteorite.position.y = Math.random() * 1000 - Math.random() * 1000;
        meteorite.position.z = Math.random() * 1000 - Math.random() * 1000;

        meteorites.add(meteorite);
    }

    return meteorites;
};
Game.prototype.initStats = function () {
    var stats = new Stats();
    stats.setMode(0);

    document.body.appendChild(stats.domElement);

    return stats;
};
Game.prototype.initGui = function () {
    var gui = new dat.GUI();

    guiParams = {
        wireframe: true
    };

    var debugFolder = gui.addFolder('Debug');

    debugFolder.add(guiParams, 'wireframe').listen().onFinishChange((function () {
        this.sun.material.wireframe = guiParams.wireframe;
        this.earth.material.wireframe = guiParams.wireframe;
        this.spaceShip.material.wireframe = guiParams.wireframe;
        this.moon.children[0].material.wireframe = guiParams.wireframe;
        this.meteorites.children.forEach((function (meteorite) {
            meteorite.material.wireframe = guiParams.wireframe
        }).bind(this));
    }).bind(this));

    return gui;
};
Game.prototype.initControls = function () {
    var controls = new THREE.OrbitControls(this.camera);
    controls.maxDistance = 1000;
    controls.minDistance = 80;

    return controls;
};
Game.prototype.shoot = function () {
    var bullet = new Bullet().create();

    bullet.position.x = this.spaceShip.position.x - 10;
    bullet.position.y = this.spaceShip.position.y;
    bullet.position.z = this.spaceShip.position.z;

    this.bullets.add(bullet);

};
Game.prototype.initEventMoveSpaceShip = function () {
    document.onkeydown = (function (e) {
        var key = e.keyCode ? e.keyCode : e.which;

        if (key == 104) { //^
            this.spaceShip.position.y += 2;
        }
        if (key == 98) { //v
            this.spaceShip.position.y -= 2;
        }
        if (key == 102) { //>
            this.spaceShip.position.x += 2;
        }
        if (key == 100) { //<
            this.spaceShip.position.x -= 2;
        }
        if (key == 97) { //<
            this.spaceShip.position.z += 5;
        }
        if (key == 99) { //<
            this.spaceShip.position.z -= 5;
        }
    }).bind(this);
};
Game.prototype.initEventShoot = function () {
    document.onkeypress = (function (e) {
        var key = e.keyCode ? e.keyCode : e.which;

        // Spacebar
        if (key == 32) {
            this.shoot();
        }
    }).bind(this);
};
Game.prototype.init = function () {
    this.renderer = this.initRender();
    this.scene = new THREE.Scene();
    this.camera = this.initCamera();
    this.stats = this.initStats();
    this.controls = this.initControls();
    this.sun = this.initSun();
    this.earth = this.initEarth();
    this.moon = this.initMoon();
    this.spaceShip = this.initSpaceShip();
    this.meteorites = this.initMeteorites(this.maxMeteorietes);

    this.scene.add(this.sun);
    this.scene.add(this.moon);
    this.scene.add(this.earth);
    this.scene.add(this.bullets);
    this.scene.add(this.spaceShip);
    this.scene.add(this.meteorites);

    this.initEventMoveSpaceShip();
    this.initEventShoot();

    this.DOMHandler.init();
    this.render();
};
Game.prototype.pause = function () {
    cancelAnimationFrame(this.requestAnimationFrameId);
};
Game.prototype.start = function () {
    if (this.requestAnimationFrameId) {
        this.render();
    } else {
        this.init();
    }
};
Game.prototype.stop = function (msg) {
    cancelAnimationFrame(this.requestAnimationFrameId);
    this.requestAnimationFrameId = null;
    this.DOMHandler.setMessage(msg);
};
Game.prototype.render = function () {
    this.requestAnimationFrameId = requestAnimationFrame(this.render.bind(this));

    this.camera.position.x = this.spaceShip.position.x + 15;
    this.camera.position.y = this.spaceShip.position.y;
    this.camera.position.z = this.spaceShip.position.z;
    this.stats.begin();
    this.renderer.render(this.scene, this.camera);
    this.stats.end();

    // Rotate the sphere
    this.earth.rotation.y += 0.001;
    this.moon.rotation.y += 0.0005;

    this.bullets.children.forEach((function (bullet) {
        bullet.position.x -= 1;
    }).bind(this));

    this.counter--;
    if (this.counter === 0) {
        this.earth.material.uniforms.ambient.value = this.light.ambientValue;
    }

    this.meteorites.children.forEach((function (meteorite, index) {
        var moveFactor = 0.05;
        var x = meteorite.position.x;
        var y = meteorite.position.y;
        var z = meteorite.position.z;

        // Planets become Red near the earth
        if (-60 < x && x < 60 && -60 < y && y < 60 && -60 < z && z < 60) {
            this.meteorites.children[index].material.uniforms.ambient.value = new THREE.Vector3(0.9, 0.1, 0.1);
        }

        if (-38 < x && x < 38 && -38 < y && y < 38 && -38 < z && z < 38) {
            this.meteorites.children.splice(index, 1);
            this.counter = 30;
            this.earth.material.uniforms.ambient.value = new THREE.Vector3(0.9, 0.1, 0.1);
            this.decreaseLife();
        }

        if (x < 0) {
            meteorite.position.x += moveFactor;
        } else {
            meteorite.position.x -= moveFactor;
        }

        if (y < 0) {
            meteorite.position.y += moveFactor;
        } else {
            meteorite.position.y -= moveFactor;
        }

        if (z < 0) {
            meteorite.position.z += moveFactor;
        } else {
            meteorite.position.z -= moveFactor;
        }
    }).bind(this));
};
