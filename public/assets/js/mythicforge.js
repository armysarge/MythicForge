class MythicForgeWindowManager {
    static #instance;

    constructor() {
        this.windows = [];
    }

    addWindow(window) {
        this.windows.push(window);
    }

    removeWindow(window) {
        this.windows = this.windows.filter(w => w !== window);
        window.manager = null;
        window.destroy();
    }
}
class MythicForgeWindow {
    constructor(theWinManager) {
        this.el = null;
        this.title = "";
        this.content = "";
        this.options = {};
        this.manager = theWinManager;
        theWinManager.addWindow(this);
    }

    /**
     * Removes the element from the DOM if it exists.
     * @method destroy
     */
    destroy() {
        if(this.el){
            if(this.manager)
                this.manager.removeWindow(this);
            this.el.remove();
        }
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
        if (typeof options == "undefined") options = {};
        this.title = title;
        this.content = content;
        this.options = options;
        var html = `<div class="mythicForgeWindow ${(typeof options.class) == "string"?options.class:""}" style='display:none'>
            <div class="windowHeader">${this.title}</div>
            <div class="windowContent"></div>
            <div class="windowClose" title="Close this window"><i class='bx bx-x'></i></div>
        </div>`;
        this.el = $(html);
        $("body").append(this.el);
        if (typeof content === "string"){
            this.el.find(".windowContent").html(content);
        }else if (content instanceof HTMLElement){
            this.el.find(".windowContent").append(content);
        }
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
        var theRenderer = Renderer.get();
        var that = this;

        switch(type){
            case "saves":
                if (obj.save)
                    return Renderer.monster.getSavesPart(obj);
                break;
            case "ability":
                if (obj[subType])
                return Renderer.utils.getAbilityRoller(obj,subType);
                break;
            case "alignment":
                if(obj.alignment)
                    return Renderer.monster.getTypeAlignmentPart(obj);
                break;
            case "habitat":
                if(obj.environment)
                    return obj.environment.join(", ");
                break;
            case "ac":
                if(obj.ac){
                    var theAC = $("<div>"+Parser.acToFull(obj.ac)+"</div>");
                    that.replace5etoolsLinks(theAC);
                    return theAC.html();
                }
                break;
            case "hp":
                if(obj.hp)
                return Renderer.monster.getRenderedHp(obj.hp,{isPlainText:false});
                break;
            case "speed":
                if (obj.speed)
                return Parser.getSpeedString(obj);
                break;
            case "initiative":
                if (obj.dex)
                return Renderer.monster.getInitiativePart(obj);
                break;
            case "resistances":
                if (obj.resist){
                    var theResistances = $("<div>"+Parser.getFullImmRes(obj.resist,{isTitleCase:true})+"</div>");
                    that.replace5etoolsLinks(theResistances);
                    return theResistances.html();
                }
                break;
            case "immunities":
                if (obj.immune){
                    var theImmunities = $("<div>"+Renderer.monster.getImmunitiesCombinedPart(obj)+"</div>");
                    that.replace5etoolsLinks(theImmunities);
                    return theImmunities.html();
                }
                break;
            case "skills":
                if (obj.skill){
                    var theSkills = $("<div>"+Renderer.monster.getSkillsString(theRenderer,obj)+"</div>");
                    that.replace5etoolsLinks(theSkills);
                    return theSkills.html();
                }
                break;
            case "senses":
                if (obj.sense){
                    var theSenses = $("<div>"+Renderer.monster.getSensesPart(obj)+"</div>");
                    that.replace5etoolsLinks(theSenses);
                    return theSenses.html();
                }
                break;
            case "cr":
                return (obj.cr)?Renderer.monster._getChallengeRatingPart_classic({mon:obj}):"-";
            case "traits":
                var html = "";
                var theTraits = Renderer.monster.getOrderedTraits(obj, theRenderer);
                if(theTraits)
                if (theTraits.length > 0){
                    var allTraits = "";

                    $.each(theTraits, function(i, it) {
                        allTraits += `<div class="property-block"><h4>${it.name}. </h4><p>${it.entries.join("</p><p>")}</p></div>`;
                    });

                    html = that.findTagsAndRender(allTraits);
                }

                return html;
            case "actions":
                var html = "";
                if (obj.action.length > 0){

                    var allActions = "";

                    $.each(obj.action, function(i, action) {
                        var actionName = that.findTagsAndRender(action.name);
                        var actionDesc = that.findTagsAndRender(action.entries.join("</p><p>"));
                        allActions += `<div class="property-block"><h4>${actionName}. </h4><p>${actionDesc}</p></div>`;
                    });

                    html = `
                    <div class="actions">
                        <h3>Actions</h3>
                        ${allActions}
                    </div> <!-- actions -->`;
                }
                return html;
            case "legendActions":
                var html = "";
                if (obj.legendaryGroup){

                    var intro = Renderer.monster.getLegendaryActionIntroEntry(obj);
                    var otherActions = DataUtil.monster.getLegendaryGroup(obj);

                    var allLegendActions = "";
                    var allLairActions = "";
                    var allRegEffects = "";
                    $.each(obj.legendary, function(i, action) {
                        var actionName = that.findTagsAndRender(action.name);
                        var actionDesc = that.findTagsAndRender(action.entries.join("</p><p>"));
                        allLegendActions += `<div class="property-block"><h4>${actionName}. </h4><p>${actionDesc}</p></div>`;
                    });

                    $(otherActions.lairActions).each(function(i,entry){
                        allLairActions += that.parseSubData(entry);
                    });

                    $(otherActions.regionalEffects).each(function(i,entry){
                        allRegEffects += that.parseSubData(entry);
                    });

                    html = `
                    <div class="actions">
                        <h3>Legendary Actions</h3>
                        <p>${intro.entries.join("</p><p>")}</p>
                        ${allLegendActions}
                    </div> <!-- actions -->`;

                    if (allLairActions != "")
                        html += `
                        <div class="actions">
                            <h3>Lair Actions</h3>
                            ${allLairActions}
                        </div> <!-- actions -->`;

                    if (allRegEffects != "")
                        html += `
                        <div class="actions">
                            <h3>Regional Effects</h3>
                            ${allRegEffects}
                        </div> <!-- actions -->`;
                }
                return html;
        }
        return "-";
    }

    /**
     * Parses and converts structured data entries into HTML markup
     * @param {Object|string} entry - The entry to parse, can be either an object with specific structure or a string
     * @param {string} [entry.type] - Type of entry ('list', 'table', or 'entries')
     * @param {Array} [entry.items] - Array of items for list type entries
     * @param {Array} [entry.colLabels] - Array of column labels for table type entries
     * @param {Array} [entry.rows] - Array of row data for table type entries
     * @param {string} [entry.name] - Name/title for entries type or property blocks
     * @param {Array} [entry.entries] - Array of sub-entries for entries type
     * @param {string} [entry.entry] - Content for property block items
     * @returns {string} HTML markup string representing the parsed entry
     */
    parseSubData(entry){
        var that = this;
        var result = "";
        if (entry.type == "list"){
            result += "<ul>";
            $.each(entry.items, function(i, item) {
                if (typeof item === "string"){
                    result += "<li>"+that.findTagsAndRender(item)+"</li>";
                }else if (typeof item === "object"){
                    if (item.entry){
                        result += "<li><div class='property-block'>";
                        if (item.name)
                            result += "<h4>"+item.name+"</h4>";
                        result += "<p>"+that.findTagsAndRender(item.entry)+"</p>";
                        result += "</div></li>";
                    }else if (item.entries){
                        $.each(item.entries, function(i, subEntry) {
                            result += "<li>"+that.findTagsAndRender(subEntry)+"</li>";
                        });
                    }
                }
            });

            result += "</ul>";
        }else if(entry.type == "table"){
            result += "<table class='MythicForgeTable'><thead><tr>";
            $(entry.colLabels).each(function(i,col){
                result += "<th>"+col+"</th>";
            });
            result += "</tr></thead><tbody>";
            $(entry.rows).each(function(i,row){
                result += "<tr>";
                $(row).each(function(i,cell){
                    result += "<td>"+cell+"</td>";
                });
                result += "</tr>";
            });
            result += "</tbody></table>";
            result += "</table>";
        }else if(entry.type == "entries"){
            result += "<div class='property-block'>";
            if (typeof entry.name != "undefined")
                result += "<h4>"+entry.name+". </h4>";

            $.each(entry.entries, function(i, subEntry) {
                result += that.parseSubData(subEntry);
            });
            result += "</div></li>";

        }else if (entry!= "") {
            result += "<p>"+that.findTagsAndRender(entry)+"</p>";
        }
        return result;
    }

    /**
     * Modifies elements with 5etools-specific data attributes to use MythicForge's inline content system.
     * This function replaces the default 5etools link behavior with MythicForge's custom handling.
     *
     * @param {HTMLElement|jQuery} el - The container element whose child elements should be processed
     *
     * @description
     * For each element with a [data-vet-page] attribute within the container:
     * - Sets onclick handler to open content via MythicForgeWindow
     * - Removes href attribute
     * - Adds 'hoverLink' class
     * - Removes various mouse event handlers (over, move, leave)
     * - Removes touch and drag event handlers
     */
    replace5etoolsLinks(el) {
        $(el).find("[data-vet-page]").each(function() {
            $(this).attr("onclick","MythicForgeWindow.openInlineContent('"+$(this).attr("data-vet-page")+"','"+$(this).attr("data-vet-source")+"','"+$(this).attr("data-vet-hash")+"')");
            $(this).removeAttr("href",`#`);
            $(this).addClass("hoverLink");
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
    static async openInlineContent(type,source,hash){

        DataLoader.pCacheAndGet(type,source,hash).then(function(data){
            var inlineContent = new MythicForgeWindow(WinManager);
            inlineContent.inlineContentHtml(data,type).then(function(theContent){
                if (theContent != ""){
                    if (type.split(".")[0] == "spells"){
                        inlineContent.spellStatsHTML(data.name,source);
                    }else{
                    inlineContent.createWindow(data.name, theContent);
                    inlineContent.el.fadeIn();
                    inlineContent.centerDivToScreen();
                    }
                }else{
                    inlineContent.destroy();
                }
            });
        });
    }

    /**
     * Generates HTML content for inline display based on data and type
     * @param {Object} data - The data object containing item information
     * @param {string} type - The type string that determines how to render the content
     * @returns {string} HTML string containing formatted inline content
     */
    async inlineContentHtml(data,type){
        if (data){
            var that = this;
            var html = "";

            var Fluffobj = "";
            if (typeof data.hasFluffImages != "undefined")
                if (data.hasFluffImages)
                    Fluffobj = await Renderer.condition.pGetFluff(data);

            html = `<div class='inlineContent'>${data.hasFluffImages?`<center><div class="fluff-image"><img src="/assets/images/5etools/${Fluffobj.images[0].href.path}"></div></center>`:""}`;

            switch(type.split(".")[0]){
                case "trapshazards":
                case "conditionsdiseases":
                    var Entries = "";
                    $.each(data.entries, function(i, subEntry) {
                        Entries += that.parseSubData(subEntry);
                    });
                    html += `${Entries}`;
                    break;
                case "skill":
                    html += `${typeof data.ability !="undefined"?`
                    Ability: ${Parser.ATB_ABV_TO_FULL[data.ability]}
                    </br>
                    <svg height="5" width="100%" class="tapered-rule">
                        <polyline points="0,0 400,2.5 0,5"></polyline>
                    </svg>
                    `:""}
                    <p>${data.entries.join("</p><p>")}</p>`;
                    break;
                case "sense":
                case "quickreference":
                case "variantrules":
                    $.each (data.entries, function(i,entry){
                        if (typeof entry === "string"){
                            html += `<p>${entry}</p>`;
                        }else if (typeof entry === "object"){
                            html += `<div class="property-block"><h4>${entry.name}</h4><p>${entry.entries.join("</p><p>")}</p></div>`;
                        }
                    });

                    break;
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
                    html += `${ItemType.html()}</br>
                        ${[Parser.itemValueToFullMultiCurrency(data), Parser.itemWeightToFull(data)].filter(Boolean).join(", ").uppercaseFirst()}</br>
                        ${theCostandWeight}
                        <svg height="5" width="100%" class="tapered-rule">
                            <polyline points="0,0 400,2.5 0,5"></polyline>
                        </svg>
                        ${ItemDesc.html()}`
                    break;
            }

            html += "</div>";

            return that.findTagsAndRender(html);
            //return (!SRDonly)?that.findTagsAndRender(html):(data.srd)?that.findTagsAndRender(html):"";
        }else{
            return "";
        }
    }

    /**
     * Finds 5etools-style tags in curly brackets and renders them into HTML content
     * @param {string} text - The input text containing tags in the format '{@tag content}'
     * @returns {string} The text with all tags replaced by their rendered HTML equivalents
     * @description Processes text containing 5etools-style tags (e.g. '{@spell Fireball}') by:
     * 1. Finding all matches using regex
     * 2. Rendering each tag using the Renderer
     * 3. Processing any 5etools links in the rendered content
     * 4. Replacing the original tag with the processed HTML
     */
    findTagsAndRender(text) {
        var that = this;
        //find curlybrackets using regex
        var regex = /{@(.*?)}/g;
        var matches = text.match(regex);
        if (matches){
            for (var i = 0; i < matches.length; i++){
                var RenderedTag = $("<div>"+Renderer.get().render(matches[i])+ "</div>");
                that.replace5etoolsLinks(RenderedTag);
                //replace the tag with the rendered tag
                text = text.replaceAll(matches[i],RenderedTag.html());
            }
        }
        return text;
    }

    /**
     * Retrieves a monster by its name and source, including its fluff data.
     * @param {string} name - The name of the monster to search for
     * @param {string} source - The source book/material the monster is from
     * @returns {Promise<Object>} A promise that resolves with the monster object including fluff data, or rejects with an error message
     * @throws {string} "Monster not found" if the monster cannot be found in AllMonsters
     */
    getMonsterByName(name, source) {
        return new Promise((resolve, reject) => {

            DataLoader.pCacheAndGetHash(UrlUtil.PG_BESTIARY, UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_BESTIARY]({name: name, source: source})).then(theMonster => {
                if (!theMonster) {
                    reject("Monster not found");
                    return;
                }

                if (source == "XMM")source = "MM";

                DataLoader.pCacheAndGetHash("monsterFluff", UrlUtil.URL_TO_HASH_BUILDER["monsterFluff"]({ name: name, source: source }))
                    .then(fluff => {
                        theMonster.fluff = fluff;
                        resolve(theMonster);
                    })
                    .catch(err => reject(err));
            });
        });
    }

    getSpellByName(name, source) {
        return new Promise((resolve, reject) => {
            DataLoader.pCacheAndGetHash(UrlUtil.PG_SPELLS, UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_SPELLS]({name: name, source: source})).then(theSpell => {
                if (!theSpell) {
                    reject("Spell not found");
                    return;
                }

                if (source == "XMM")source = "MM";

                DataLoader.pCacheAndGetHash("spellFluff", UrlUtil.URL_TO_HASH_BUILDER["spellFluff"]({ name: name, source: source }))
                    .then(fluff => {
                        theSpell.fluff = fluff;
                        resolve(theSpell);
                    })
                    .catch(err => reject(err));
            });
        });
    }

    getItemByName(name, source) {
        return new Promise((resolve, reject) => {
            DataLoader.pCacheAndGetHash(UrlUtil.PG_ITEMS, UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_ITEMS]({name: name, source: source})).then(theItem => {
                if (!theItem) {
                    reject("Item not found");
                    return;
                }

                if (source == "XMM")source = "MM";

                DataLoader.pCacheAndGetHash("itemFluff", UrlUtil.URL_TO_HASH_BUILDER["itemFluff"]({ name: name, source: source }))
                    .then(fluff => {
                        theItem.fluff = fluff;
                        resolve(theItem);
                    })
                    .catch(err => reject(err));
            });
        });
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
    monsterStatsHTML(name,source){
        var that = this;
        that.getMonsterByName(name,source).then(function(monster){
            if(monster){
                that.monster = monster;

                that.createWindow(monster.name+"&nbsp;<sup>"+monster.source+"</sup>", "",{class:"monsterWindow"});

                var monsterSaves = that.dataParser(monster,"saves");
                var monsterHabitat = that.dataParser(monster,"habitat");
                var monsterPicture = (monster.fluff)?(monster.fluff.images)?(monster.fluff.images[0].href.path) ? `<div class="StatBlockImage"><img src="/assets/images/5etools/${monster.fluff.images[0].href.path}"></div>` : "":"":"";
                if (monsterPicture == "" && (monster.hasToken || typeof monster.token != "undefined"))
                    monsterPicture = `<div class="StatBlockImage"><img src="/assets/images/5etools/${Renderer.monster.getTokenUrl(monster).replace("img/","/")}"></div>`;
                var monsterSkills = that.dataParser(monster,"skills");
                var monsterSenses = that.dataParser(monster,"senses");
                var monsterImmunities = that.dataParser(monster,"immunities");
                var monsterResistances = that.dataParser(monster,"resistances");

                var html = `
                <div class="StatBlock">
                    <div class="section-left">
                        ${monsterPicture}
                        <div class="creature-heading">
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
                            <div class="property-line last">
                                <h4>Initiative</h4>
                                <p>${that.dataParser(monster,"initiative")}</p>
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

                            ${monsterSaves != "-" ? `
                            <div class="property-line">
                                <h4>Saving Throws</h4>
                                <p>${monsterSaves}</p>
                            </div> <!-- property line -->` : ""}

                            ${monsterSkills != "-" ? `
                            <div class="property-line">
                                <h4>Skills</h4>
                                <p>${monsterSkills}</p>
                            </div> <!-- property line -->` : ""}

                            ${monsterResistances != "-" ? `
                            <div class="property-line">
                                <h4>Resistances</h4>
                                <p>${monsterResistances}</p>
                            </div> <!-- property line -->` : ""}

                            ${monsterImmunities != "-" ? `
                            <div class="property-line">
                                <h4>Immunities</h4>
                                <p>${monsterImmunities}</p>
                            </div> <!-- property line -->` : ""}

                            ${monsterSenses != "-" ? `
                            <div class="property-line">
                                <h4>Senses</h4>
                                <p>${monsterSenses}</p>
                            </div> <!-- property line -->` : ""}

                            ${monster.languages ? `
                            <div class="property-line">
                                <h4>Languages</h4>
                                <p>${monster.languages.join(", ")}</p>
                            </div> <!-- property line -->` : ""}

                            ${monsterHabitat != "-" ? `
                            <div class="property-line">
                                <h4>Habitat</h4>
                                <p>${monsterHabitat}</p>
                            </div> <!-- property line -->` : ""}

                            <div class="property-line">
                                <h4>Challenge</h4>
                                <p>${that.dataParser(monster,"cr")}</p>
                            </div> <!-- property line -->
                        </div> <!-- top stats -->
                        <svg height="5" width="100%" class="tapered-rule">
                            <polyline points="0,0 400,2.5 0,5"></polyline>
                        </svg>
                    </div> <!-- section left -->
                    <div class="section-right">
                        ${that.dataParser(monster,"traits")}
                        ${that.dataParser(monster,"actions")}
                        ${that.dataParser(monster,"legendActions")}
                    </div> <!-- section right -->
                </div>`;
                that.el.find(".windowContent").html(html);
                that.el.fadeIn();
                that.centerDivToScreen();
            }
        });

    }

    /**
     * Creates and displays a spell stat block in the UI.
     * @param {string} name - The name of the spell to display
     * @param {string} source - The source/book where the spell data comes from
     * @returns {void}
     * @description This method fetches spell data based on name and source, then generates and displays an HTML stat block
     * containing the spell's statistics, casting information, and other game-relevant information. The stat block follows D&D 5E
     * formatting conventions and includes an optional spell image if available in the data. Once generated, the stat block
     * is inserted into the DOM and displayed with a fade animation.
     */
    spellStatsHTML(name,source){
        var that = this;
        that.getSpellByName(name,source).then(function(spell){
            console.log(spell);
            if(spell){
                that.spell = spell;

                var spellPicture = (spell.fluff)?(spell.fluff.images)?(spell.fluff.images[0].href.path) ? `<div class="StatBlockImage"><img src="/assets/images/5etools/${spell.fluff.images[0].href.path}"></div>` : "":"":"";
                var spellCasting = Parser.spTimeListToFull(spell.time, spell.meta);
                var spellRange = Parser.spRangeToFull(spell.range);
                var spellComponents = Parser.spComponentsToFull(spell.components);
                var spellDuration = Parser.spDurationToFull(spell.duration);
                var SavingThrow = "";
                if (typeof spell.savingThrow == "array")
                    SavingThrow = spell.SavingThrow.join(", ");
                if (spellDuration != ""){
                    spellDuration = $("<div>"+spellDuration+"</div>");
                    that.replace5etoolsLinks(spellDuration);
                    spellDuration = spellDuration.html();
                }
                var Entries = "";
                $.each(spell.entries, function(i, subEntry) {
                    Entries += that.parseSubData(subEntry);
                });

                var EntriesHigherLevel = "";
                if (spell.entriesHigherLevel){
                    $.each(spell.entriesHigherLevel, function(i, subEntry) {
                        EntriesHigherLevel += that.parseSubData(subEntry);
                    });
                }

                var spellRaces = "";
                if(spell.races)
                    spellRaces = spell.races.map(c => (c.baseName)?c.baseName:c.name).join(", ");

                var spellClasses = "";
                var spellSubClasses = "";
                if (spell.classes){
                    if (spell.classes.fromClassList)
                        spellClasses = spell.classes.fromClassList.map(c => c.name).join(", ");
                    if (spell.classes.fromSubclass)
                        spellSubClasses = spell.classes.fromSubclass.map(c => c.subclass.name).join(", ");
                }
                var spellOptions = "";
                if (spell.optionalfeatures)
                    spellOptions = spell.optionalfeatures.map(c => c.name).join(", ");

                that.createWindow(spell.name+"&nbsp;<sup>"+spell.source+"</sup>", "",{class:"spellWindow"});
                var html = `<div class="StatBlock">
                    ${spellPicture != "" ? `
                    <div class="section-left">
                        ${spellPicture}
                    </div>
                    ` : ""}
                    <div class="section-right">
                        ${Renderer.spell.getHtmlPtLevelSchoolRitual(spell)}
                        <div class="top-stats">
                            ${spellCasting != "" ? `
                            <div class="property-line">
                                <h4>Casting Time:</h4>
                                <p>${spellCasting}</p>
                            </div> <!-- property line -->
                            ` : ""}
                            ${spellRange != "" ? `
                            <div class="property-line">
                                <h4>Range:</h4>
                                <p>${spellRange}</p>
                            </div> <!-- property line -->
                            ` : ""}
                            ${spellComponents != "" ? `
                            <div class="property-line">
                                <h4>Components:</h4>
                                <p>${spellComponents}</p>
                            </div> <!-- property line -->
                            ` : ""}
                            ${spellDuration != "" ? `
                            <div class="property-line">
                                <h4>Duration:</h4>
                                <p>${spellDuration}</p>
                            </div> <!-- property line -->
                            ` : ""}
                            ${SavingThrow != "" ? `
                            <div class="property-line">
                                <h4>Saving Throw:</h4>
                                <p>${SavingThrow}</p>
                            </div> <!-- property line -->
                            ` : ""}
                        </div>
                        <svg height="5" width="100%" class="tapered-rule">
                            <polyline points="0,0 400,2.5 0,5"></polyline>
                        </svg>
                        ${Entries}
                        ${EntriesHigherLevel}
                        <svg height="5" width="100%" class="tapered-rule">
                            <polyline points="0,0 400,2.5 0,5"></polyline>
                        </svg>
                        ${spellRaces != "" ? `
                        <div class="property-line">
                            <h4>Species:</h4>
                            <p>${spellRaces}</p>
                        </div> <!-- property line -->
                        ` : ""}
                        ${spellClasses != "" ? `
                        <div class="property-line">
                            <h4>Classes:</h4>
                            <p>${spellClasses}</p>
                        </div> <!-- property line -->
                        ` : ""}
                        ${spellSubClasses ? `
                        <div class="property-line">
                            <h4>Subclasses:</h4>
                            <p>${spellSubClasses}</p>
                        </div> <!-- property line -->
                        ` : ""}
                        ${spellOptions ? `
                        <div class="property-line">
                            <h4>Other Options/Features:</h4>
                            <p>${spellOptions}</p>
                        </div> <!-- property line -->
                        ` : ""}
                    </div>
                </div>`;
                that.el.find(".windowContent").html(html);
                that.el.fadeIn();
                that.centerDivToScreen();
            }
        });
    }

    itemStatsHTML(name,source){
        var that = this;
        that.getItemByName(name,source).then(function(item){
            console.log(item);
            if(item){
                that.item = item;

                var itemPicture = (item.fluff)?(item.fluff.images)?(item.fluff.images[0].href.path) ? `<div class="StatBlockImage"><img src="/assets/images/5etools/${item.fluff.images[0].href.path}"></div>` : "":"":"";

                that.createWindow(item.name+"&nbsp;<sup>"+item.source+"</sup>", "",{class:"itemWindow"});
                var html = `<div class="StatBlock">
                    <div class="section-left">
                        ${itemPicture}
                    </div>
                    <div class="section-right">
                    </div>
                </div>`;
                that.el.find(".windowContent").html(html);
                that.el.fadeIn();
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
            that.destroy();
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

    /**
     * Shows the Mythic Forge window element.
     */
    show(){
        this.mythicForgeWindowIndex();
        this.el.fadeIn();
    }

    betterExplainProperty(property){
        //use AI to explain a property
    }
}