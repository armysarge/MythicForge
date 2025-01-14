class MythicForgeWindow {
    constructor() {

    }

    /**
     * Creates and appends a new window element to the document body
     * @param {string} title - The title text to display in the window header
     * @param {string|HTMLElement} content - The content to display in the window body
     * @param {Object} options - Configuration options for the window
     * @property {Object} el - jQuery element reference to the created window
     * @property {string} title - Stored title value
     * @property {string|HTMLElement} content - Stored content value
     * @property {Object} options - Stored options value
     */
    createWindow(title, content, options) {
        this.title = title;
        this.content = content;
        this.options = options;
        var html = `<div class="mythicForgeWindow" style='display:none'>
            <div class="windowHeader">${this.title}</div>
            <div class="windowContent">${this.content}</div>
            <div class="windowClose" title="Close this window"><i class='bx bx-x'></i></div>
        </div>`;
        this.el = $(html);
        $("body").append(this.el);
        setTimeout(() => {
            this.centerDivToScreen();
            this.initEvents();
        }, 1);
    }

    /**
     * Parses and formats different types of 5eTools data elements
     * @param {Object} obj - The object containing the data to be parsed
     * @param {string} type - The type of data to parse ('ability', 'alignment', 'ac', 'hp', 'speed' etc.)
     * @param {string} [subType] - Optional subtype parameter used for ability parsing
     * @returns {string|HTMLElement} Formatted HTML string or element depending on the type parsed
     * @description Handles parsing and formatting of stat block elements, replacing 5etools links
     * with inline content handlers and removing unwanted event handlers.
     */
    dataParser(obj,type,subType){
        var that = this;

        switch(type){
            case "ability":
                if (obj[subType])
                return Renderer.utils.getAbilityRoller(obj,subType);
            case "alignment":
                if(obj.alignment)
                    return Renderer.monster.getTypeAlignmentPart(obj);
            case "ac":
                if(obj.ac){
                    var theAC = $("<div>"+Parser.acToFull(obj.ac)+"</div>");
                    that.replace5etoolsLinks(theAC);
                    return theAC.html();
                }
            case "hp":
                if(obj.hp)
                return Renderer.monster.getRenderedHp(obj.hp,{isPlainText:false});
            case "speed":
                if (obj.speed)
                return Parser.getSpeedString(obj);
        }
        return "-";
    }

    replace5etoolsLinks(el) {
        $(el).find("a[data-vet-page]").each(function() {
            $(this).attr("onclick","MythicForgeWindow.openInlineContent('"+$(this).attr("data-vet-page")+"','"+$(this).attr("data-vet-source")+"','"+$(this).attr("data-vet-hash")+"')");
            $(this).attr("href",`#`);
            $(this).removeAttr("onmouseover");
            $(this).removeAttr("onmousemove");
            $(this).removeAttr("onmouseleave");
            $(this).removeAttr("ontouchstart");
            $(this).removeAttr("ondragstart");
        });
    }

    /**
     * Opens inline content in a new window using MythicForgeWindow.
     * @param {string} type - The type of content to be loaded
     * @param {string} source - The source/location of the content
     * @param {string} hash - The hash identifier for the content
     * @returns {Promise<void>} - A promise that resolves when the content window is created and displayed
     */
    static openInlineContent(type,source,hash){
        DataLoader.pCacheAndGet(type,source,hash).then(function(data){
            var inlineContent = new MythicForgeWindow();
            inlineContent.createWindow(data.name, inlineContent.inlineContentHtml(data,type));
            inlineContent.el.fadeIn();
            inlineContent.centerDivToScreen();
        });
    }

    /**
     * Generates HTML content for inline display based on data and type
     * @param {Object} data - The data object containing item information
     * @param {string} type - The type string that determines how to render the content
     * @returns {string} HTML string containing formatted inline content
     */
    inlineContentHtml(data,type){
        var that = this;
        var html = "";
        console.log(data,Renderer.item.getHtmlAndTextTypes(data));
        switch(type.split(".")[0]){
            case "items":

                const [ptDamage, ptProperties] = Renderer.item.getRenderedDamageAndProperties(data);
                const ptMastery = Renderer.item.getRenderedMastery(data);

                const theCostandWeight = [
                    ptDamage,
                    ptProperties,
                    ptMastery,
                ]
                    .filter(Boolean)
                    .map(pt => `<div class="ve-text-wrap-balance ve-text-right">${pt.uppercaseFirst()}</div>`)
                    .join("");

                var ItemType = $(`<div>${Renderer.item.getTypeRarityAndAttunementText(data).join("")}</div>`);
                that.replace5etoolsLinks(ItemType)
                var ItemDesc = $(`<div>${Renderer.item.hasEntries(data) ? Renderer.item.getRenderedEntries(data, {isCompact: true}) : ""}</div>`);
                that.replace5etoolsLinks(ItemDesc)
                html = `<div class='inlineContent'>
                    ${ItemType.html()}</br>
                    ${[Parser.itemValueToFullMultiCurrency(data), Parser.itemWeightToFull(data)].filter(Boolean).join(", ").uppercaseFirst()}</br>
                    ${theCostandWeight}
                    <svg height="5" width="100%" class="tapered-rule">
                        <polyline points="0,0 400,2.5 0,5"></polyline>
                    </svg>
                    ${ItemDesc.html()}
                    </div>`;
        }
        return (!SRDonly)?html:(data.srd)?html:"";
    }

    /**
     * Creates and displays a monster stat block in the UI.
     * @param {string} name - The name of the monster to display
     * @param {string} source - The source/book where the monster data comes from
     * @returns {void}
     * @description This method fetches monster data based on name and source, then generates and displays an HTML stat block
     * containing the monster's statistics, abilities, actions and other game-relevant information. The stat block follows D&D 5E
     * formatting conventions and includes an optional monster image if available in the data. Once generated, the stat block
     * is inserted into the DOM and displayed with a fade animation.
     */
    monsterStatBlock(name,source){
        var that = this;
        getMonsterByName(name,source).then(function(monster){
            if(monster){
                console.log(monster);
                that.monster = monster;

                var monsterPicture = (monster.fluff)?(monster.fluff.images)?(monster.fluff.images[0].href.path) ? `<div class="monsterStatBlockImage"><img src="/assets/images/5etools/${monster.fluff.images[0].href.path}"></div>` : "":"":"";

                var html = `
                ${monsterPicture}
                <div class="monsterStatBlock">
                    <div class="section-left">
                        <div class="creature-heading">
                            <!--<h1>${monster.name}</h1>-->
                            <h2>${that.dataParser(monster,"alignment")}</h2>
                        </div> <!-- creature heading -->
                        <svg height="5" width="100%" class="tapered-rule">
                            <polyline points="0,0 400,2.5 0,5"></polyline>
                        </svg>
                        <div class="top-stats">
                            <div class="property-line first">
                                <h4>Armor Class</h4>
                                <p>${that.dataParser(monster,"ac")}</p>
                            </div> <!-- property line -->
                            <div class="property-line">
                                <h4>Hit Points</h4>
                                <p>${that.dataParser(monster,"hp")}</p>
                            </div> <!-- property line -->
                            <div class="property-line last">
                                <h4>Speed</h4>
                                <p>${that.dataParser(monster,"speed")}</p>
                            </div> <!-- property line -->
                            <svg height="5" width="100%" class="tapered-rule">
                                <polyline points="0,0 400,2.5 0,5"></polyline>
                            </svg>
                            <div class="abilities">
                                <div class="ability-strength">
                                    <h4>STR</h4>
                                    <p>${that.dataParser(monster,"ability","str")}</p>
                                </div> <!-- ability strength -->
                                <div class="ability-dexterity">
                                    <h4>DEX</h4>
                                    <p>${that.dataParser(monster,"ability","dex")}</p>
                                </div> <!-- ability dexterity -->
                                <div class="ability-constitution">
                                    <h4>CON</h4>
                                    <p>${that.dataParser(monster,"ability","con")}</p>
                                </div> <!-- ability constitution -->
                                <div class="ability-intelligence">
                                    <h4>INT</h4>
                                    <p>${that.dataParser(monster,"ability","int")}</p>
                                </div> <!-- ability intelligence -->
                                <div class="ability-wisdom">
                                    <h4>WIS</h4>
                                    <p>${that.dataParser(monster,"ability","wis")}</p>
                                </div> <!-- ability wisdom -->
                                <div class="ability-charisma">
                                    <h4>CHA</h4>
                                    <p>${that.dataParser(monster,"ability","cha")}</p>
                                </div> <!-- ability charisma -->
                            </div> <!-- abilities -->
                            <svg height="5" width="100%" class="tapered-rule">
                                <polyline points="0,0 400,2.5 0,5"></polyline>
                            </svg>
                            <div class="property-line first">
                                <h4>Damage Immunities</h4>
                                <p>poison, psychic</p>
                            </div> <!-- property line -->
                            <div class="property-line">
                                <h4>Condition Immunities</h4>
                                <p>blinded, charmed, deafened, exhaustion, frightened, petrified, poisoned</p>
                            </div> <!-- property line -->
                            <div class="property-line">
                                <h4>Senses</h4>
                                <p>blindsight 60ft. (blind beyond this radius), passive Perception 6</p>
                            </div> <!-- property line -->
                            <div class="property-line">
                                <h4>Languages</h4>
                                <p>&mdash;</p>
                            </div> <!-- property line -->
                            <div class="property-line last">
                                <h4>Challenge</h4>
                                <p>1 (200 XP)</p>
                            </div> <!-- property line -->
                        </div> <!-- top stats -->
                        <svg height="5" width="100%" class="tapered-rule">
                            <polyline points="0,0 400,2.5 0,5"></polyline>
                        </svg>
                        <div class="property-block">
                            <h4>Antimagic Suceptibility.</h4>
                            <p>The armor is incapacitated while in the area of an <i>antimagic
                            field</i>.  If targeted by <i>dispel magic</i>, the armor must succeed
                            on a Constitution saving throw against the caster’s spell save DC or
                            fall unconscious for 1 minute.</p>
                        </div> <!-- property block -->
                        <div class="property-block">
                            <h4>False Appearance.</h4>
                            <p>While the armor remains motionless, it is indistinguishable from a normal suit of armor.</p>
                        </div> <!-- property block -->
                    </div> <!-- section left -->
                    <div class="section-right">
                        <div class="actions">
                            <h3>Actions</h3>
                            <div class="property-block">
                                <h4>Multiattack.</h4>
                                <p>The armor makes two melee attacks.</p>
                            </div> <!-- property block -->
                            <div class="property-block">
                                <h4>Slam.</h4>
                                <p>
                                    <i>Melee Weapon Attack:</i> +4 to hit, reach 5 ft., one target.
                                    <i>Hit:</i> 5 (1d6 + 2) bludgeoning damage.
                                </p>
                            </div> <!-- property block -->
                        </div> <!-- actions -->
                        <div class="actions">
                            <h3>Legendary Actions</h3>
                            <div class="property-block">
                                <h4>Multiattack.</h4>
                                <p>The armor makes two melee attacks.</p>
                            </div> <!-- property block -->
                            <div class="property-block">
                                <h4>Slam.</h4>
                                <p>
                                    <i>Melee Weapon Attack:</i> +4 to hit, reach 5 ft., one target.
                                    <i>Hit:</i> 5 (1d6 + 2) bludgeoning damage.
                                </p>
                            </div> <!-- property block -->
                        </div> <!-- actions -->
                    </div> <!-- section right -->
                </div>`;
                that.el.find(".windowContent").html(html);
                that.el.fadeIn(function(){
                });
                that.centerDivToScreen();
            }
        });

    }

    /**
     * Initializes event handlers for the Mythic Forge window element.
     * Sets up click/tap events and draggable functionality.
     *
     * @method initEvents
     * @memberof MythicForgeWindow
     * @instance
     * @description
     * - Handles window focus via click/tap
     * - Handles window close button clicks
     * - Makes window draggable within parent container
     * - Updates window z-index when dragged or focused
     */
    initEvents() {
        var that = this;
        that.el.on("click tap", function(evt) {
            if ($(this).hasClass("focused")) return;
            that.mythicForgeWindowIndex();
        });

        that.el.on("click tap", ".windowClose", function(evt) {
            $(this).parent().css("display", "none");
        });

        that.el.draggable({containment: "parent",onStart: function() {
            that.mythicForgeWindowIndex();
        }});
    }

    /**
     * Updates z-index and focus state for a mythic forge window element.
     * Removes 'focused' class from all mythic forge windows, finds the highest
     * z-index among existing windows, and sets this window's z-index one higher.
     * Finally, adds 'focused' class to this window.
     *
     * @method mythicForgeWindowIndex
     * @memberof MythicForgeWindow
     * @this {MythicForgeWindow}
     * @returns {void}
     */
    mythicForgeWindowIndex(){
        $(".mythicForgeWindow").removeClass("focused");
        var highestZ = 10;
        $(".mythicForgeWindow").each(function() {
            var currentZ = parseInt($(this).css("z-index"));
            if (currentZ > highestZ) {
                highestZ = currentZ;
            }
        });

        this.el.css("z-index", highestZ + 1);
        $(this.el).addClass("focused");
    }

    /**
     * Centers an element on the screen and maintains centering during window resizes.
     * The element is positioned fixed and made visible after centering.
     * Includes debounced window resize handling to prevent excessive recalculation.
     *
     * @method centerDivToScreen
     * @memberof YourClassName
     * @instance
     * @fires mythicForgeWindowIndex
     * @requires jQuery
     * @returns {void}
     */
    centerDivToScreen(){
        var windowWidth = $(window).width();
        var windowHeight = $(window).height();
        var elementWidth = this.el.outerWidth();
        var elementHeight = this.el.outerHeight();

        this.el.css({
            "position": "fixed",
            "left": (windowWidth - elementWidth) / 2,
            "top": (windowHeight - elementHeight) / 2,
            "visibility": "visible"
        });

        var resizeTimer;

        // Recenter on window resize
        $(window).on('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                this.centerDivToScreen();
            }, 200);
        });

        this.mythicForgeWindowIndex();
    }

    /**
     * Creates a story for the monster using AI by making a POST request to the '/story' endpoint.
     * @async
     * @function createMonsterStory
     * @returns {Promise<void>}
     * @throws {Error} If the fetch request fails
     * @requires this.monster - Monster object must be defined before calling this method
     * @example
     * await createMonsterStory();
     */
    async createMonsterStory(){
        //create monster story using AI
        if (this.monster){

                const response = await fetch('/story', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({monster: this.monster})
                });

                console.log(await response.json());
            /*
            var monsterStory = new MythicForgeWindow();
            monsterStory.createWindow("Monster Story", "");
            monsterStory.el.fadeIn();
            monsterStory.centerDivToScreen();*/
        }
    }
}