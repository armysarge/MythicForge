import DiceBox from "/assets/plugins/dice-box/dist/dice-box.es.min.js";

/**
 * @file script.js
 * @fileoverview The main script file for Mythic Forge application, handling monster data management,
 * window creation, and UI interactions.
 *
 * @requires jQuery
 * @requires jQuery UI
 * @requires Renderer
 * @requires Parser
 * @requires DataLoader
 * @requires UrlUtil
 *
 * @global {boolean} SRDonly - Flag to determine if only SRD content should be displayed
 * @global {Array} AllMonsters - Array of all monster data loaded from 5etools
 * @global {Array} AllSpells - Array of all spell data loaded from 5etools
 * @global {DiceBox} diceBox - Instance of the DiceBox class for dice rolling
 * @global {MythicForgeWindow} RollboxWindow - Instance of the MythicForgeWindow class for the roll box
 *
 * @author Shaun Scholtz
 * @version 0.0.1
 * @license AGPLv3
 *
 * @example
 * // Create a new window
 * const window = new MythicForgeWindow();
 * window.createWindow('Title', 'Content');
 *
 * // Display monster stat block
 * createMonsterStatBlock('Goblin', 'MM');
 */
var AllMonsters = [];
var AllSpells = [];
var AllItems = [];
var SRDonly = true;
let diceBox, RollboxWindow;

//Override the dice roller to use the dice box
Renderer.dice.bindOnclickListener = function(ele) {
    ele.addEventListener("click", (evt) => {
        let eleDice = null;
        if (evt.target.hasAttribute("data-packed-dice")) {
            eleDice = evt.target;
        } else if (evt.target.parentElement && evt.target.parentElement.hasAttribute("data-packed-dice")) {
            eleDice = evt.target.parentElement;
        }

        if (!eleDice) return;

        evt.preventDefault();
        evt.stopImmediatePropagation();

        const packed = JSON.parse(eleDice.getAttribute("data-packed-dice"));

        if(packed.rollable === false) return;
        console.log(packed);
        const toRoll = packed.toRoll.replace(/\+0/g, "").replace(/-0/g, "");
        const rollType = packed.subType;
        var diceTheme = "wooden";

        switch(rollType){
            case "damage":
                //if SHIFT click, roll critical
                if (evt.shiftKey) {
                    toRoll = "2" + toRoll;
                }else if (evt.ctrlKey) {
                    toRoll = "0" + toRoll;
                }
                break;
            case "d20":
                //if SHIFT click, roll with advantage
                if (evt.shiftKey) {
                    toRoll = "2d20kh1" + toRoll;
                }else if (evt.ctrlKey) {
                    toRoll = "2d20kl1" + toRoll;
                }
                break;
        }

        RollboxWindow.show();

        //TODO: Support for advantage/disadvantage rolls
        //TODO: Show text in the roll box
        //TODO: Spell Cast ad different levels, require a prompt for the level, see Fireball

        diceBox.onRollComplete = (rollResult)=>{
            console.log(rollType,rollResult)
        };

        diceBox.roll(toRoll).then((result) => {

        });
    });
}

RollboxWindow = new MythicForgeWindow();
RollboxWindow.createWindow('Roll Box', "");
RollboxWindow.el.addClass("rollboxWindow notInitialized");
RollboxWindow.el.show();

// Document ready function
$.when( $.ready ).then(function() {

    //Load all monster data from 5etools
    DataLoader.pCacheAndGetAllSite(UrlUtil.PG_BESTIARY,1).then(function(data){
        AllMonsters = data;
    });

    //Load all spell data from 5etools
    DataLoader.pCacheAndGetAllSite(UrlUtil.PG_SPELLS,1).then(function(data){
        AllSpells = data;
    });

    //Load all items data from 5etools
    DataLoader.pCacheAndGetAllSite(UrlUtil.PG_ITEMS,1).then(function(data){
        AllItems = data;
    });

    //Open and close the items window
    $(".showItems").on("click tap", function(evt) {
        if ($(".itemsWindow").length == 0) {
            var itemsWindow = new MythicForgeWindow();
            itemsWindow.createWindow("Items", `
                <div class="itemsContent">
                <input type="search" id="lst_search" class="mythicForgeInput searchItems" placeholder="Search here">
                <table class="itemsList">
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th>Type</th>
                            <th>Rarity</th>
                            <th>Source</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
                </div>
            `);

            itemsWindow.el.addClass("itemsWindow");
            itemsWindow.el.fadeIn();

            $(".itemsWindow").on("click tap", ".itemsList .itemItem", function(evt) {
                var itemName = $(this).data("name");
                var itemSource = $(this).data("source");
                createItemStatBlock(itemName,itemSource);
            });

            let searchTimeout;
            $(".itemsWindow").on("keyup", ".searchItems", function(evt) {
                const search = $(this).val().toLowerCase();
                if (search.length < 3) return;

                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    const itemsList = $(".itemsWindow .itemsList");
                    itemsList.find("tbody").remove();
                    const tbody = $("<tbody></tbody>");

                    var results = SearchAll(search, "item");
                    $.each(results, function(i, item){
                        if (i > 100) return;
                        var itemType = (typeof item.type != "undefined")?Renderer.item.getItemTypeName(item.type):"-";
                        var itemRarity = item.rarity.toLowerCase();
                        var tr = `<tr class='itemItem' data-name="${item.name}" data-source="${item.source}">

                            <td>${item.name}</td>
                            <td>${itemType}</td>
                            <td>${itemRarity}</td>
                            <td title='${item.source?Parser.sourceJsonToFull(item.source):"N/A"}'>${item.source?item.source:"-"}</td>
                        </tr>`;
                        tbody.append(tr);

                        if (item.reprintedAs){
                            $.each(item.reprintedAs, function(r, reprinted){
                                var reprintedName = reprinted.split("|")[0];
                                var reprintedSource = reprinted.split("|")[1];
                                var tr = `<tr class='itemItem' data-name="${reprintedName}" data-source="${reprintedSource}">
                                    <td>${reprintedName}</td>
                                    <td>${itemType}</td>
                                    <td>${itemRarity}</td>
                                    <td title='${reprintedSource?Parser.sourceJsonToFull(reprintedSource):"N/A"}'>${reprintedSource?reprintedSource:"-"}</td>
                                </tr>`;
                                tbody.append(tr);
                            });
                        }

                    });
                    itemsList.append(tbody);
                }, 500);
            });
        }else{
            if ($(".itemsWindow").css("display") == "block" && $(".itemsWindow").hasClass("focused")) {
                $(".itemsWindow").css("display", "none");
                return;
            }else{
                $(".itemsWindow").fadeIn();
            }
        }
    });

    // Open and close the spells window
    $(".showSpells").on("click tap", function(evt) {
        if ($(".spellsWindow").length == 0) {
            var spellsWindow = new MythicForgeWindow();
            spellsWindow.createWindow("Spells", `
                <div class="spellsContent">
                <input type="search" id="lst_search" class="mythicForgeInput searchSpells" placeholder="Search here">
                <table class="spellsList">
                    <thead>
                        <tr>
                            <th>Spell</th>
                            <th>Level</th>
                            <th>School</th>
                            <th>Source</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
                </div>
            `);

            spellsWindow.el.addClass("spellsWindow");
            spellsWindow.el.fadeIn();

            $(".spellsWindow").on("click tap", ".spellsList .spellItem", function(evt) {
                var spellName = $(this).data("name");
                var spellSource = $(this).data("source");
                createSpellStatBlock(spellName,spellSource);
            });

            let searchTimeout;
            $(".spellsWindow").on("keyup", ".searchSpells", function(evt) {
                const search = $(this).val().toLowerCase();
                if (search.length < 3) return;

                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    const spellsList = $(".spellsWindow .spellsList");
                    spellsList.find("tbody").remove();
                    const tbody = $("<tbody></tbody>");

                    var results = SearchAll(search, "spell");
                    $.each(results, function(i, spell){
                        if (i > 100) return;
                        var spellLevel = spell.level;
                        var spellSchool = Parser.spSchoolAndSubschoolsAbvsToFull(spell.school);
                        var tr = `<tr class="spellItem" data-name="${spell.name}" data-source="${spell.source}">
                            <td>${spell.name}</td>
                            <td>${spellLevel}</td>
                            <td>${spellSchool}</td>
                            <td title='${spell.source?Parser.sourceJsonToFull(spell.source):"N/A"}'>${spell.source?spell.source:"-"}</td>
                        </tr>`;
                        tbody.append(tr);

                        if (spell.reprintedAs){
                            $.each(spell.reprintedAs, function(r, reprinted){
                                var reprintedName = reprinted.split("|")[0];
                                var reprintedSource = reprinted.split("|")[1];
                                var tr = `<tr class="spellItem" data-name="${reprintedName}" data-source="${reprintedSource}">
                                    <td>${reprintedName}</td>
                                    <td>${spellLevel}</td>
                                    <td>${spellSchool}</td>
                                    <td title='${reprintedSource?Parser.sourceJsonToFull(reprintedSource):"N/A"}'>${reprintedSource?reprintedSource:"-"}</td>
                                </tr>`;
                                tbody.append(tr);
                            });
                        }
                    });
                    spellsList.append(tbody);
                }
                , 500);
            });
        }else{
            if ($(".spellsWindow").css("display") == "block" && $(".spellsWindow").hasClass("focused")) {
                $(".spellsWindow").css("display", "none");
                return;
            }else{
                $(".spellsWindow").fadeIn();
            }
        }
    });

    // Open and close the bestiary window
    $(".showBestiary").on("click tap", function(evt) {
        if ($(".bestiaryWindow").length == 0) {
            var bestiaryWindow = new MythicForgeWindow();
            bestiaryWindow.createWindow("Bestiary", `
                <div class="bestiaryContent">
                <input type="search" id="lst_search" class="mythicForgeInput searchBestiary" placeholder="Search here">
                <table class="bestiaryList">
                    <thead>
                        <tr>
                            <th>Monster</th>
                            <th>Type</th>
                            <th>CR</th>
                            <th>Source</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
                </div>
            `);

            bestiaryWindow.el.addClass("bestiaryWindow");
            bestiaryWindow.el.fadeIn();

            $(".bestiaryWindow").on("click tap", ".bestiaryList .bestiaryItem", function(evt) {
                var monsterName = $(this).data("name");
                var monsterSource = $(this).data("source");
                createMonsterStatBlock(monsterName,monsterSource);
            });

            let searchTimeout;
            $(".bestiaryWindow").on("keyup", ".searchBestiary", function(evt) {
                const search = $(this).val().toLowerCase();
                if (search.length < 3) return;

                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    const bestiaryList = $(".bestiaryWindow .bestiaryList");
                    bestiaryList.find("tbody").remove();
                    const tbody = $("<tbody></tbody>");

                    var results = SearchAll(search, "monster");
                    $.each(results, function(i, monster){
                        if (i > 100) return;
                        var monsterAlignment = Renderer.monster.getTypeAlignmentPart(monster);
                        var monsterCR = (monster.cr)?monster.cr:"-";
                        if (typeof monsterCR == "object") monsterCR = monsterCR.cr;
                        var tr = `<tr class='bestiaryItem' data-name="${monster.name}" data-source="${monster.source}">
                            <td>${monster.name}</td>
                            <td>${monsterAlignment}</td>
                            <td>${monsterCR}</td>
                            <td title='${monster.source?Parser.sourceJsonToFull(monster.source):"N/A"}'>${monster.source?monster.source:"-"}</td>
                        </tr>`;
                        tbody.append(tr);

                        if (monster.reprintedAs){
                            $.each(monster.reprintedAs, function(r, reprinted){
                                var reprintedName = reprinted.split("|")[0];
                                var reprintedSource = reprinted.split("|")[1];
                                var tr = `<tr class='bestiaryItem' data-name="${reprintedName}" data-source="${reprintedSource}">
                                    <td>${reprintedName}</td>
                                    <td>${monsterAlignment}</td>
                                    <td>${monsterCR}</td>
                                    <td title='${reprintedSource?Parser.sourceJsonToFull(reprintedSource):"N/A"}'>${reprintedSource?reprintedSource:"-"}</td>
                                </tr>`;
                                tbody.append(tr);
                            });
                        }
                    });
                    bestiaryList.append(tbody);
                }, 500);
            });
        }else{
            if ($(".bestiaryWindow").css("display") == "block" && $(".bestiaryWindow").hasClass("focused")) {
                $(".bestiaryWindow").css("display", "none");
                return;
            }else{
                $(".bestiaryWindow").fadeIn();
            }
        }
    });

    diceBox = new DiceBox(".rollboxWindow .windowContent", {
        assetPath: "/assets/",
        theme: "smooth",
        themeColor: "#FE3E03FF",
        scale: 14,
        gravity: 1.7,
        mass: 1.7,
    });

    diceBox.init().then(() => {
        RollboxWindow.el.hide();
        RollboxWindow.el.removeClass("notInitialized");
    });

    console.log(diceBox);
});

/**
 * Searches through all monsters based on a search term and returns matching results
 * @param {string} term - The search term to look for in monster properties
 * @param {string} where - Currently unused parameter indicating search location
 * @returns {Array} Array of monster objects that match the search criteria
 * @description Searches monster names, sources and types for matches to the search term.
 * If SRDonly flag is true, only returns monsters from the SRD (System Reference Document).
 * The search is case-insensitive and uses partial matching.
 */
function SearchAll(term, where) {
    var results = [];

    switch(where.toLowerCase()){
        case "item":
            $.each(AllItems, function(itemIndex, item){
                if (SRDonly)
                    if (typeof item.srd != "undefined"){
                        //if srd is true, then the item is from the srd
                        if (!item.srd){
                            //remove the item from the list
                            return;
                        }
                    }else{
                        //remove the item from the list
                        return;
                    }

                var itemName = item.name.toLowerCase();
                var itemSource = item.source.toLowerCase();

                if (itemName.toLowerCase().includes(term) || itemSource.toLowerCase().includes(term))
                    results.push(item);
            });
            break;
        case "monster":
            $.each(AllMonsters, function(monsterIndex, monster){
                if (SRDonly)
                    if (typeof monster.srd != "undefined"){
                        //if srd is true, then the monster is from the srd
                        if (!monster.srd){
                            //remove the monster from the list
                            return;
                        }
                    }else{
                        //remove the monster from the list
                        return;
                    }

                var monsterName = monster.name.toLowerCase();
                var monsterSource = monster.source.toLowerCase();
                var monsterType = "";

                if (monster.type.type) {
                    if (typeof monster.type.type != "string") {
                        if (monster.type.type.choose)
                            monsterType = monster.type.type.choose.join(", ").toLowerCase();
                    }else{
                        monsterType = monster.type.type.toLowerCase();
                    }
                }

                if (monsterName.toLowerCase().includes(term) || monsterSource.toLowerCase().includes(term) || monsterType.toLowerCase().includes(term)) {
                    results.push(monster);
                }
            });
            break;
        case "spell":
            $.each(AllSpells, function(spellIndex, spell){
                if (SRDonly)
                    if (typeof spell.srd != "undefined"){
                        //if srd is true, then the spell is from the srd
                        if (!spell.srd){
                            //remove the spell from the list
                            return;
                        }
                    }else{
                        //remove the spell from the list
                        return;
                    }

                var spellName = spell.name.toLowerCase();
                var spellSource = spell.source.toLowerCase();

                if (spellName.toLowerCase().includes(term) || spellSource.toLowerCase().includes(term))
                    results.push(spell);
            });
            break;
        default:

            break;
    }
    return results;
}

/**
 * Creates and displays a monster stat block window using MythicForge
 * @param {string} monster - The name of the monster to display
 * @param {string} source - The source book or reference where the monster data comes from
 * @returns {void} - Does not return a value
 * @async - Contains asynchronous operation via Promise
 */
function createMonsterStatBlock(monster,source){
    var monsterStatBlock = new MythicForgeWindow();
    monsterStatBlock.monsterStatsHTML(monster,source);
}

/**
 * Creates and displays a spell stat block window using MythicForge
 * @param {string} spell - The name of the spell to display
 * @param {string} source - The source book or reference where the spell data comes from
 * @returns {void} - Does not return a value
 * @async - Contains asynchronous operation via Promise
 */
function createSpellStatBlock(spell,source){
    var spellStatBlock = new MythicForgeWindow();
    spellStatBlock.spellStatsHTML(spell,source);
}

/**
 * Creates and displays an item stat block window using MythicForge
 * @param {string} item - The name of the item to display
 * @param {string} source - The source book or reference where the item data comes from
 * @returns {void} - Does not return a value
 * @async - Contains asynchronous operation via Promise
 */
function createItemStatBlock(item,source){
    var itemStatBlock = new MythicForgeWindow();
    itemStatBlock.itemStatsHTML(item,source);
}

Object.assign(globalThis, {
    createMonsterStatBlock,
    createSpellStatBlock,
    SearchAll
});