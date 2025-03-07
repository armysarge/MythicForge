function openCharactersWindow() {
    if ($(".charsWindow").length == 0) {
        var charsWindow = new MythicForgeWindow(WinManager);
        charsWindow.createWindow("Characters", `
            <div class="charsContent">
                <div class="charsList">
                    <div class='mythicForgeLoader'></div>
                </div>
                <button style='display:none' class="btn fantasy-button fixed-width btn-lg addChar">New Character</button>
            </div>
        `,{
            class: "charsWindow",
        });

        charsWindow.el.fadeIn();

        $.get("/data?type=characters", function(data) {
            if (data !== ""){
                var AllCharacters = data;
                charsWindow.el.find(".charsList").find(".mythicForgeLoader").remove();
                charsWindow.el.find(".charsContent").find(".addChar").show();

                if (AllCharacters.length>0){
                    $.each(AllCharacters, function(i, character) {

                        if (character.avatar == null){
                            character.avatar = `/assets/images/ui/${character.gender}-avatar.webp`;
                        }else{
                            //convert sqlite blob to base64
                            var base64Flag = 'data:image/jpeg;base64,';
                            var imageStr = arrayBufferToBase64(character.avatar.data);
                            character.avatar = base64Flag + imageStr;
                        }

                        var tr = `<div class='charItem' title='Edit ${character.name}'>
                            <div class='charAvatar'><img src='${character.avatar}'></div>
                            <div class='charStats'>
                                <div class='charName'>${character.name}</div>
                                <div class='charLevel'>Level:&nbsp;${character.level}</div>
                                <div class='charRace'>Race:&nbsp;${StrUtil.uppercaseFirst(character.race)}</div>
                                <div class='charClass'>Class:&nbsp;${StrUtil.uppercaseFirst(character.class)}</div>
                            </div>
                        </div>`;
                        charsWindow.el.find(".charsList").append(tr);
                        charsWindow.el.find(".charsList").find(".charItem").last().data("id", character.character_id);
                    });

                    charsWindow.el.find(".charsList").off("click tap", ".charItem").on("click tap", ".charItem", function(evt) {
                        var characterID = $(this).data("id");
                        charsWindow.destroy();
                        $.get("/data?type=character&q="+characterID, function(data) {
                            var character = data[0];

                            if (character.avatar == null){
                                character.avatar = `/assets/images/ui/${character.gender}-avatar.webp`;
                            }else{
                                //convert sqlite blob to base64
                                var base64Flag = 'data:image/jpeg;base64,';
                                var imageStr = arrayBufferToBase64(character.avatar.data);
                                character.avatar = base64Flag + imageStr;
                            }

                            var charWindow = new MythicForgeWindow(WinManager,"char"+characterID);

                            charWindow.createWindow(character.name, `
                                <div class="charContent">
                                    <div class="container">
                                        <!-- Left Panel - Character Summary -->
                                        <div class="character-panel">

                                            <!-- Avatar Section -->
                                            <div class="avatar-container">
                                                <div class="avatar" title="Click to upload avatar">
                                                    <img src="${character.avatar}">
                                                </div>
                                            </div>

                                            <div class="form-group">
                                                <input type="text" id="character-name" title='Character Name' placeholder="Enter name" value="${character.name}">
                                            </div>

                                            <div class="character-basic-info">
                                                <div class="form-group">
                                                    <label>Gender</label>
                                                    <div class="stat-item">
                                                        <span title='Male' class='male-icon ${(character.gender == "male")?"active":""}'><box-icon name='male-sign'></box-icon></span>
                                                        <span title='Female' class='female-icon ${(character.gender == "female")?"active":""}'><box-icon name='female-sign'></box-icon></span>
                                                    </div>
                                                </div>
                                                <div class="form-group">
                                                    <label>Race</label>
                                                    <div class="stat-item" title='Click to choose race'>
                                                        <span class="selected-race">${StrUtil.uppercaseFirst(character.race.split("|")[0])}</span>
                                                    </div>
                                                </div>
                                                <div class="form-group">
                                                    <label>Class</label>
                                                    <div class="stat-item" title='Click to choose class'>
                                                        <span class="selected-class">${StrUtil.uppercaseFirst(character.class.split("|")[0])}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div class="form-group" style='display:none'>
                                                <label>Ability Scores</label>
                                                <div class="ability-scores">
                                                    <div class="stat-item">
                                                        <div class="stat-label">STR</div>
                                                        <div class="stat-value">10</div>
                                                        <div class="stat-modifier">+0</div>
                                                    </div>
                                                    <div class="stat-item">
                                                        <div class="stat-label">DEX</div>
                                                        <div class="stat-value">10</div>
                                                        <div class="stat-modifier">+0</div>
                                                    </div>
                                                    <div class="stat-item">
                                                        <div class="stat-label">CON</div>
                                                        <div class="stat-value">10</div>
                                                        <div class="stat-modifier">+0</div>
                                                    </div>
                                                    <div class="stat-item">
                                                        <div class="stat-label">INT</div>
                                                        <div class="stat-value">10</div>
                                                        <div class="stat-modifier">+0</div>
                                                    </div>
                                                    <div class="stat-item">
                                                        <div class="stat-label">WIS</div>
                                                        <div class="stat-value">10</div>
                                                        <div class="stat-modifier">+0</div>
                                                    </div>
                                                    <div class="stat-item">
                                                        <div class="stat-label">CHA</div>
                                                        <div class="stat-value">10</div>
                                                        <div class="stat-modifier">+0</div>
                                                    </div>
                                                </div>
                                            </div>

                                            <div class="form-group">
                                                <label>Combat</label>
                                                <div class="combat-stats">
                                                    <div class="stat-item">
                                                        <div class="stat-label">HP</div>
                                                        <input class="stat-value" value="${character.hit_points}"/>
                                                    </div>
                                                    <div class="stat-item">
                                                        <div class="stat-label">AC</div>
                                                        <div class="stat-value">${character.armor_class}</div>
                                                    </div>
                                                    <div class="stat-item">
                                                        <div class="stat-label">Initiative</div>
                                                        <div class="stat-value">${character.initiative}</div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <!-- Right Panel Container -->
                                        <div class="creation-panel">
                                            <!-- Top Panel - Content changes based on selection -->
                                            <div class="content-panel" id="content-area"></div>

                                            <!-- Bottom Panel - Navigation -->
                                            <div class="navigation-panel">
                                                <div class="tab-buttons">
                                                    <button class="tab-button active">Abilities</button>
                                                    <button class="tab-button">Background</button>
                                                    <button class="tab-button">Feats</button>
                                                    <button class="tab-button">Equipment</button>
                                                    <button class="tab-button">Spells</button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            `,{
                                class: "charWindow",
                            });
                            charWindow.char = character;
                            initCharacterPanel(character);
                            if(charWindow.el != null)charWindow.el.fadeIn();
                        });
                    });
                }else{
                    charsWindow.el.find(".charsList").append("<div class='noChars'>No characters found</div>");
                }
            }
        });
    } else {
        if ($(".charsWindow").css("display") == "block" && $(".charsWindow").hasClass("focused")) {
            $(".charsWindow").css("display", "none");
            return;
        } else {
            $(".charsWindow").fadeIn();
        }
    }
}

function initCharacterPanel(character) {
    // Store selectors as variables for better readability and performance
    const $avatar = $(".avatar");
    const $name = $("#character-name");

    $(".selected-race").off("click tap").on("click tap",()=> openRaceWindow(character));
    $(".selected-class").off("click tap").on("click tap",()=> openClassWindow(character));
}

function openRaceWindow(character) {
    if ($(".racesWindow").length == 0) {
        var raceWindow = new MythicForgeWindow(WinManager, "charrace"+character.character_id);
        raceWindow.createWindow("Select Race", {
            class: "racesWindow",
        });
        raceWindow.getRaceByName(character.race.split("|")[0],character.race.split("|")[1]).then(function(race){
            if(race){
                console.log(race);
            }
        });

        raceWindow.character = character;
        if (raceWindow.el != null) raceWindow.el.fadeIn();
    }
}

function openClassWindow(character) {
    if ($(".classesWindow").length == 0) {
        var classWindow = new MythicForgeWindow(WinManager, "charclass"+character.character_id);
        classWindow.createWindow("Select Class", {
            class: "classesWindow",
        });
        classWindow.getClassByName(character.class.split("|")[0],character.class.split("|")[1]).then(function(charClass){
            if(charClass){
                console.log(charClass);
            }
        });
        classWindow.character = character;

        if (classWindow.el != null) classWindow.el.fadeIn();
    }
}